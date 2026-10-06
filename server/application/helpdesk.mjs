import {
  HelpdeskError,
  isAdmin,
  isSupportJid,
  phoneFromJid,
  routeIncoming,
  routeOwnMessage,
  initialStatus,
  validateStatusChange,
  nextAssignee,
  statusActivity,
  assignmentActivity,
  teamActivity,
  requireInboxAccess,
} from '../domain/helpdesk.mjs';

const RECEIPT_RANK = { pending: 0, sent: 1, delivered: 2, read: 3 };
const actorName = (user) => user?.display_name || user?.name || null;

/** Conversation use cases: WhatsApp ingestion, agent replies, status and assignment. */
export function helpdeskService({
  helpdesk,
  users,
  whatsapp,
  mirror,
  bus,
  now = () => Math.floor(Date.now() / 1000),
}) {
  const visibleInboxIds = (user) => (isAdmin(user) ? null : users.memberInboxIds(user.id));
  function load(user, displayId) {
    const conversation = helpdesk.conversation(displayId);
    if (!conversation) throw new HelpdeskError('Conversa não encontrada', 404);
    if (user) requireInboxAccess(user, users.memberInboxIds(user.id), conversation.inbox_id);
    return conversation;
  }
  function activity(conversation, content, events) {
    const message = helpdesk.insertMessage({
      conversationId: conversation.id,
      inboxId: conversation.inbox_id,
      messageType: 'activity',
      content,
      senderType: 'system',
      createdAt: now(),
    });
    events.push(['message.created', message]);
  }
  function autoAssign(conversation, events) {
    const inbox = helpdesk.inbox(conversation.inbox_id);
    if (!inbox.enable_auto_assignment || conversation.assignee_id || conversation.status !== 'open')
      return conversation;
    const team = conversation.team_id ? users.team(conversation.team_id) : null;
    const candidates = users.assignableIds(inbox.id, team?.allow_auto_assign ? team.id : null);
    const chosen = nextAssignee(candidates, users.assignmentCursor(inbox.id));
    if (!chosen) return conversation;
    users.setAssignmentCursor(inbox.id, chosen);
    helpdesk.addParticipant(conversation.id, chosen);
    const updated = helpdesk.updateConversation(conversation.id, { assignee_id: chosen });
    activity(updated, assignmentActivity(null, updated.assignee_name), events);
    events.push(['assignee.changed', updated]);
    return updated;
  }
  /** Runs a unit of work atomically and publishes its events only after commit. */
  function commit(work) {
    const events = [];
    const result = helpdesk.transaction(() => work(events));
    for (const [name, data] of events) bus.emit(name, data);
    return result;
  }
  function contactInboxFor(inbox, d, events) {
    const existing = helpdesk.contactInbox(inbox.id, d.jid);
    if (existing) return existing;
    if (d.fromMe) return null;
    const phone = phoneFromJid(d.jid) || phoneFromJid(d.altJid);
    let contact = phone ? helpdesk.contactByPhone(phone) : null;
    if (!contact) {
      contact = helpdesk.createContact({ name: d.pushName, phone });
      events.push(['contact.created', contact]);
    }
    return helpdesk.createContactInbox(contact.id, inbox.id, d.jid);
  }

  return {
    /** Live WhatsApp message (not history sync) entering the support flow. */
    ingest(sessionId, d) {
      return commit((events) => {
        const inbox = helpdesk.inboxForSession(sessionId);
        if (!inbox || !isSupportJid(d.jid, { ignoreGroups: Boolean(inbox.ignore_groups) })) return null;
        if (helpdesk.messageBySource(inbox.id, d.id)) return null;
        const contactInbox = contactInboxFor(inbox, d, events);
        if (!contactInbox) return null;
        let conversation = helpdesk.latestConversation(contactInbox.id);
        const route = d.fromMe ? routeOwnMessage(conversation) : routeIncoming(conversation, inbox);
        if (route.action === 'ignore') return null;
        if (route.action === 'create') {
          conversation = helpdesk.createConversation({
            inboxId: inbox.id,
            contactId: contactInbox.contact_id,
            contactInboxId: contactInbox.id,
            status: initialStatus({ hasBot: false }),
            ts: d.ts,
          });
          events.push(['conversation.created', conversation]);
        } else if (route.reopen) {
          conversation = helpdesk.updateConversation(conversation.id, {
            status: 'open',
            snoozed_until: null,
          });
          events.push(['conversation.status_changed', conversation]);
        }
        const message = helpdesk.insertMessage({
          conversationId: conversation.id,
          inboxId: inbox.id,
          messageType: d.fromMe ? 'outgoing' : 'incoming',
          content: d.body,
          contentType: d.kind === 'conversation' || d.kind === 'extendedTextMessage' ? 'text' : d.kind,
          senderType: d.fromMe ? 'system' : 'contact',
          senderId: d.fromMe ? null : contactInbox.contact_id,
          sourceId: d.id,
          waJid: d.jid,
          createdAt: d.ts,
        });
        const contact = helpdesk.contact(contactInbox.contact_id);
        helpdesk.updateContact(contact.id, {
          last_activity_at: d.ts,
          name: contact.name || d.pushName || undefined,
        });
        conversation = helpdesk.updateConversation(conversation.id, {
          last_activity_at: Math.max(conversation.last_activity_at, d.ts),
          ...(d.fromMe ? {} : { waiting_since: conversation.waiting_since ?? d.ts }),
        });
        events.push(['message.created', message]);
        if (!d.fromMe) autoAssign(conversation, events);
        return message;
      });
    },
    receipt(sessionId, sourceId, status) {
      const inbox = helpdesk.inboxForSession(sessionId);
      const message = inbox && helpdesk.messageBySource(inbox.id, sourceId);
      if (!message || !status) return;
      if (status !== 'failed' && (RECEIPT_RANK[status] ?? 0) <= (RECEIPT_RANK[message.status] ?? 0)) return;
      bus.emit('message.updated', helpdesk.updateMessage(message.id, { status }));
    },

    conversations: (user, filters) =>
      helpdesk.conversations({ ...filters, userId: user.id, visibleInboxIds: visibleInboxIds(user) }),
    meta: (user, filters) =>
      helpdesk.conversationCounts({ ...filters, userId: user.id, visibleInboxIds: visibleInboxIds(user) }),
    conversation: (user, displayId) => load(user, displayId),
    messages: (user, displayId, before, limit) => helpdesk.messages(load(user, displayId).id, before, limit),
    /** Older WhatsApp history for the contact, read from the local mirror. */
    history(user, displayId, before, beforeId, limit) {
      const conversation = load(user, displayId);
      const inbox = helpdesk.inbox(conversation.inbox_id);
      return mirror.messages(inbox.session_id, conversation.contact_jid, before, limit, beforeId);
    },
    markSeen(user, displayId) {
      const conversation = load(user, displayId);
      return helpdesk.updateConversation(conversation.id, { agent_last_seen_at: now() });
    },

    async reply(user, displayId, { content, private: isPrivate = false }) {
      const conversation = load(user, displayId);
      const inbox = helpdesk.inbox(conversation.inbox_id);
      const sourceId = isPrivate ? null : whatsapp.newMessageId();
      const message = commit((events) => {
        const stored = helpdesk.insertMessage({
          conversationId: conversation.id,
          inboxId: inbox.id,
          messageType: 'outgoing',
          content,
          private: isPrivate,
          status: isPrivate ? 'sent' : 'pending',
          senderType: 'user',
          senderId: user.id,
          sourceId,
          waJid: isPrivate ? null : conversation.contact_jid,
          createdAt: now(),
        });
        helpdesk.addParticipant(conversation.id, user.id);
        events.push(['message.created', stored]);
        if (isPrivate) return stored;
        let updated = helpdesk.updateConversation(conversation.id, {
          last_activity_at: now(),
          waiting_since: null,
          first_reply_at: conversation.first_reply_at ?? now(),
        });
        if (!updated.assignee_id && !isAdmin(user)) {
          updated = helpdesk.updateConversation(conversation.id, { assignee_id: user.id });
          activity(updated, assignmentActivity(actorName(user), actorName(user)), events);
          events.push(['assignee.changed', updated]);
        }
        return stored;
      });
      if (isPrivate) return message;
      try {
        await whatsapp.send(inbox.session_id, conversation.contact_jid, content, { messageId: sourceId });
        const current = helpdesk.message(message.id);
        // A delivery receipt may already have advanced the status while the send was in flight.
        if (current.status !== 'pending') return current;
        const sent = helpdesk.updateMessage(message.id, { status: 'sent' });
        bus.emit('message.updated', sent);
        return sent;
      } catch (error) {
        const failed = helpdesk.updateMessage(message.id, {
          status: 'failed',
          contentAttributes: { external_error: error?.message || 'Falha no envio' },
        });
        bus.emit('message.updated', failed);
        return failed;
      }
    },

    toggleStatus(user, displayId, { status, snoozed_until = null }) {
      const conversation = load(user, displayId);
      validateStatusChange(status, snoozed_until, now());
      if (conversation.status === status && status !== 'snoozed') return conversation;
      return commit((events) => {
        let updated = helpdesk.updateConversation(conversation.id, {
          status,
          snoozed_until: status === 'snoozed' ? snoozed_until : null,
        });
        activity(updated, statusActivity(actorName(user), status), events);
        events.push(['conversation.status_changed', updated]);
        if (status === 'open') updated = autoAssign(updated, events);
        return updated;
      });
    },
    assign(user, displayId, { assignee_id, team_id }) {
      const conversation = load(user, displayId);
      return commit((events) => {
        let updated = conversation;
        if (team_id !== undefined && team_id !== conversation.team_id) {
          if (team_id !== null && !users.team(team_id)) throw new HelpdeskError('Time não encontrado', 404);
          updated = helpdesk.updateConversation(conversation.id, { team_id });
          activity(updated, teamActivity(actorName(user), updated.team_name), events);
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
          activity(updated, assignmentActivity(actorName(user), updated.assignee_name), events);
          events.push(['assignee.changed', updated]);
        } else if (assignee_id === undefined && team_id) {
          updated = autoAssign(updated, events);
        }
        return updated;
      });
    },
    /** Wakes snoozed conversations whose time has come; called periodically by the composition root. */
    wakeSnoozed() {
      for (const { id } of helpdesk.dueSnoozed(now()))
        commit((events) => {
          const updated = helpdesk.updateConversation(id, { status: 'open', snoozed_until: null });
          events.push(['conversation.status_changed', updated]);
          autoAssign(updated, events);
        });
    },

    contacts: (_user, q, page) => helpdesk.contacts(q, page),
    contact(user, id) {
      const contact = helpdesk.contact(id);
      if (!contact) throw new HelpdeskError('Contato não encontrado', 404);
      return { ...contact, conversations: helpdesk.contactConversations(id, visibleInboxIds(user)) };
    },
    updateContact(_user, id, fields) {
      if (!helpdesk.contact(id)) throw new HelpdeskError('Contato não encontrado', 404);
      const updated = helpdesk.updateContact(id, fields);
      bus.emit('contact.updated', updated);
      return updated;
    },
  };
}
