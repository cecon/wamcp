import {
  HelpdeskError,
  isAdmin,
  validateStatusChange,
  statusActivity,
  assignmentActivity,
  teamActivity,
  labelsActivity,
  normalizeLabelTitle,
} from '../domain/helpdesk.mjs';
import { conversationCore, actorName, performerOf, botActor } from './conversation-core.mjs';
import { ingestion } from './ingestion.mjs';

/**
 * Conversation use cases. `actor` is an agent (user row) or the MCP bot of an inbox (`botActor`);
 * bots only reach their own inbox and reply as `agent_bot`.
 */
export function helpdeskService({
  helpdesk,
  users,
  whatsapp,
  mirror,
  bus,
  now = () => Math.floor(Date.now() / 1000),
}) {
  const core = conversationCore({ helpdesk, users, bus, now });
  const { load, activity, autoAssign, commit } = core;

  async function deliver(message, inbox, conversation, actor) {
    try {
      await whatsapp.send(inbox.session_id, conversation.contact_jid, message.content, {
        messageId: message.source_id,
      });
      const current = helpdesk.message(message.id);
      // A delivery receipt may already have advanced the status while the send was in flight.
      if (current.status !== 'pending') return current;
      const sent = helpdesk.updateMessage(message.id, { status: 'sent' });
      bus.emit('message.updated', sent, performerOf(actor));
      return sent;
    } catch (error) {
      const failed = helpdesk.updateMessage(message.id, {
        status: 'failed',
        contentAttributes: { external_error: error?.message || 'Falha no envio' },
      });
      bus.emit('message.updated', failed, performerOf(actor));
      return failed;
    }
  }

  return {
    ...ingestion({ helpdesk, bus, core }),
    botFor(sessionId) {
      const inbox = helpdesk.inboxForSession(sessionId);
      if (!inbox) throw new HelpdeskError('Sessão não encontrada', 404);
      return botActor(inbox);
    },
    canReach: (actor, inboxId) => isAdmin(actor) || core.memberInboxIds(actor).includes(inboxId),

    conversations: (actor, filters) =>
      helpdesk.conversations({ ...filters, userId: actor.id, visibleInboxIds: core.visibleInboxIds(actor) }),
    meta: (actor, filters) =>
      helpdesk.conversationCounts({
        ...filters,
        userId: actor.id,
        visibleInboxIds: core.visibleInboxIds(actor),
      }),
    conversation: (actor, displayId) => load(actor, displayId),
    messages: (actor, displayId, before, limit) =>
      helpdesk.messages(load(actor, displayId).id, before, limit),
    /** Older WhatsApp history for the contact, read from the local mirror. */
    history(actor, displayId, before, beforeId, limit) {
      const conversation = load(actor, displayId);
      const inbox = helpdesk.inbox(conversation.inbox_id);
      return mirror.messages(inbox.session_id, conversation.contact_jid, before, limit, beforeId);
    },
    markSeen(actor, displayId) {
      const conversation = load(actor, displayId);
      return helpdesk.updateConversation(conversation.id, { agent_last_seen_at: now() });
    },

    async reply(actor, displayId, { content, private: isPrivate = false }) {
      const conversation = load(actor, displayId);
      const inbox = helpdesk.inbox(conversation.inbox_id);
      const message = commit((events) => {
        const stored = helpdesk.insertMessage({
          conversationId: conversation.id,
          inboxId: inbox.id,
          messageType: 'outgoing',
          content,
          private: isPrivate,
          status: isPrivate ? 'sent' : 'pending',
          senderType: actor.bot ? 'agent_bot' : 'user',
          senderId: actor.bot ? null : actor.id,
          sourceId: isPrivate ? null : whatsapp.newMessageId(),
          waJid: isPrivate ? null : conversation.contact_jid,
          createdAt: now(),
        });
        if (!actor.bot) helpdesk.addParticipant(conversation.id, actor.id);
        events.push(['message.created', stored]);
        if (isPrivate) return stored;
        let updated = helpdesk.updateConversation(conversation.id, {
          last_activity_at: now(),
          waiting_since: null,
          first_reply_at: conversation.first_reply_at ?? now(),
        });
        // Like Chatwoot, an agent replying to an unassigned conversation takes it.
        if (!updated.assignee_id && !actor.bot && !isAdmin(actor)) {
          updated = helpdesk.updateConversation(conversation.id, { assignee_id: actor.id });
          activity(updated, assignmentActivity(actorName(actor), actorName(actor)), events);
          events.push(['assignee.changed', updated]);
        }
        return stored;
      }, actor);
      return isPrivate ? message : deliver(message, inbox, conversation, actor);
    },

    toggleStatus(actor, displayId, { status, snoozed_until = null }) {
      const conversation = load(actor, displayId);
      validateStatusChange(status, snoozed_until, now());
      if (conversation.status === status && status !== 'snoozed') return conversation;
      return commit((events) => {
        let updated = helpdesk.updateConversation(conversation.id, {
          status,
          snoozed_until: status === 'snoozed' ? snoozed_until : null,
        });
        activity(updated, statusActivity(actorName(actor), status), events);
        events.push(['conversation.status_changed', updated]);
        if (conversation.status === 'pending' && status === 'open')
          events.push(['conversation.bot_handoff', updated]);
        if (status === 'open') updated = autoAssign(updated, events);
        return updated;
      }, actor);
    },

    assign(actor, displayId, { assignee_id, team_id }) {
      const conversation = load(actor, displayId);
      return commit((events) => {
        let updated = conversation;
        if (team_id !== undefined && team_id !== conversation.team_id) {
          if (team_id !== null && !users.team(team_id)) throw new HelpdeskError('Time não encontrado', 404);
          updated = helpdesk.updateConversation(conversation.id, { team_id });
          activity(updated, teamActivity(actorName(actor), updated.team_name), events);
          events.push(['team.changed', updated]);
        }
        if (assignee_id !== undefined && assignee_id !== conversation.assignee_id) {
          if (assignee_id !== null) {
            const assignee = users.user(assignee_id);
            const member = assignee && users.memberInboxIds(assignee.id).includes(conversation.inbox_id);
            if (!assignee?.active || !(member || isAdmin(assignee)))
              throw new HelpdeskError('Agente sem acesso a esta caixa de entrada', 422);
            helpdesk.addParticipant(conversation.id, assignee_id);
          }
          updated = helpdesk.updateConversation(conversation.id, { assignee_id });
          activity(updated, assignmentActivity(actorName(actor), updated.assignee_name), events);
          events.push(['assignee.changed', updated]);
        } else if (assignee_id === undefined && team_id) {
          updated = autoAssign(updated, events);
        }
        return updated;
      }, actor);
    },

    /** Replaces the conversation labels; every title must be an existing label. */
    setLabels(actor, displayId, titles) {
      const conversation = load(actor, displayId);
      const wanted = [...new Set(titles.map(normalizeLabelTitle))];
      const labels = wanted.length ? helpdesk.labelsByTitles(wanted) : [];
      const missing = wanted.filter((t) => !labels.some((l) => l.title.toLowerCase() === t));
      if (missing.length) throw new HelpdeskError(`Etiqueta inexistente: ${missing.join(', ')}`, 422);
      const next = labels.map((l) => l.title);
      const added = next.filter((t) => !conversation.labels.includes(t));
      const removed = conversation.labels.filter((t) => !next.includes(t));
      if (!added.length && !removed.length) return conversation;
      return commit((events) => {
        const updated = helpdesk.setConversationLabels(
          conversation.id,
          labels.map((l) => l.id),
        );
        activity(updated, labelsActivity(actorName(actor), added, removed), events);
        events.push(['conversation.updated', updated]);
        return updated;
      }, actor);
    },

    contacts: (_actor, q, page) => helpdesk.contacts(q, page),
    contact(actor, id) {
      const contact = helpdesk.contact(id);
      if (!contact) throw new HelpdeskError('Contato não encontrado', 404);
      return { ...contact, conversations: helpdesk.contactConversations(id, core.visibleInboxIds(actor)) };
    },
    updateContact(actor, id, fields) {
      if (!helpdesk.contact(id)) throw new HelpdeskError('Contato não encontrado', 404);
      const updated = helpdesk.updateContact(id, fields);
      bus.emit('contact.updated', updated, performerOf(actor));
      return updated;
    },
  };
}
