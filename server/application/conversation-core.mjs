import {
  HelpdeskError,
  isAdmin,
  nextAssignee,
  assignmentActivity,
  requireInboxAccess,
} from '../domain/helpdesk.mjs';

export const BOT_NAME = 'Assistente IA';

/** The MCP client acting on one inbox, like a Chatwoot agent bot. */
export const botActor = (inbox) => ({
  bot: true,
  id: null,
  inboxId: inbox.id,
  name: BOT_NAME,
  role: 'agent_bot',
});
export const actorName = (actor) => actor?.display_name || actor?.name || null;
export const performerOf = (actor) =>
  actor?.bot ? { type: 'agent_bot', id: actor.inboxId } : actor ? { type: 'user', id: actor.id } : undefined;

/** Shared building blocks for conversation use cases: access, activities, auto-assignment, commits. */
export function conversationCore({ helpdesk, users, bus, now }) {
  const memberInboxIds = (actor) => (actor.bot ? [actor.inboxId] : users.memberInboxIds(actor.id));
  const core = {
    now,
    memberInboxIds,
    visibleInboxIds: (actor) => (isAdmin(actor) ? null : memberInboxIds(actor)),
    load(actor, displayId) {
      const conversation = helpdesk.conversation(displayId);
      if (!conversation) throw new HelpdeskError('Conversa não encontrada', 404);
      if (actor) requireInboxAccess(actor, memberInboxIds(actor), conversation.inbox_id);
      return conversation;
    },
    activity(conversation, content, events) {
      const message = helpdesk.insertMessage({
        conversationId: conversation.id,
        inboxId: conversation.inbox_id,
        messageType: 'activity',
        content,
        senderType: 'system',
        createdAt: now(),
      });
      events.push(['message.created', message]);
    },
    /** Round robin among online inbox members (restricted to the team when it allows auto-assign). */
    autoAssign(conversation, events) {
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
      core.activity(updated, assignmentActivity(null, updated.assignee_name), events);
      events.push(['assignee.changed', updated]);
      return updated;
    },
    /** Runs a unit of work atomically and publishes its events only after commit. */
    commit(work, actor) {
      const events = [];
      const result = helpdesk.transaction(() => work(events));
      for (const [name, data] of events) bus.emit(name, data, performerOf(actor));
      return result;
    },
  };
  return core;
}
