import { HelpdeskError, isAdmin } from '../domain/helpdesk.mjs';

/**
 * Agent notifications (Chatwoot's NotificationListener):
 * - conversation_assignment: someone else assigned the conversation to you;
 * - assigned_conversation_new_message: the contact wrote in a conversation assigned to you;
 * - conversation_creation: a new conversation arrived in one of your inboxes and nobody took it.
 */
export function notificationService({ helpdesk, users, bus, now = () => Math.floor(Date.now() / 1000) }) {
  function notify(userId, type, conversation, performer) {
    const notification = helpdesk.createNotification({
      userId,
      type,
      conversationId: conversation.id,
      actorUserId: performer?.type === 'user' ? performer.id : null,
      createdAt: now(),
    });
    bus.emit('notification.created', notification);
  }
  function onEvent({ event, data, performer }) {
    if (event === 'assignee.changed' && data.assignee_id) {
      if (performer?.type === 'user' && performer.id === data.assignee_id) return;
      notify(data.assignee_id, 'conversation_assignment', data, performer);
    } else if (event === 'message.created' && data.message_type === 'incoming') {
      const conversation = helpdesk.conversationById(data.conversation_id);
      if (conversation?.assignee_id)
        notify(conversation.assignee_id, 'assigned_conversation_new_message', conversation);
    } else if (event === 'conversation.created' && data.status === 'open') {
      // Auto-assignment runs in the same commit; only still-unassigned conversations alert the inbox.
      const conversation = helpdesk.conversationById(data.id);
      if (conversation && !conversation.assignee_id)
        for (const member of users.inboxMembers(conversation.inbox_id))
          if (member.active && !isAdmin(member)) notify(member.id, 'conversation_creation', conversation);
    }
  }
  return {
    listen: () => bus.subscribe(onEvent),
    list: (user) => ({
      items: helpdesk.notifications(user.id),
      unread: helpdesk.unreadNotifications(user.id),
    }),
    unreadCount: (user) => ({ unread: helpdesk.unreadNotifications(user.id) }),
    read(user, id) {
      if (!helpdesk.readNotification(user.id, id, now()))
        throw new HelpdeskError('Notificação não encontrada', 404);
      return { unread: helpdesk.unreadNotifications(user.id) };
    },
    readAll(user) {
      helpdesk.readAllNotifications(user.id, now());
      return { unread: 0 };
    },
  };
}
