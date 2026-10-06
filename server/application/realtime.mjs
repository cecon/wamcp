import { isAdmin } from '../domain/helpdesk.mjs';

/**
 * Per-agent event stream (Chatwoot's ActionCable RoomChannel): administrators get everything,
 * agents get events from their inboxes, and notifications go only to their owner.
 */
export function realtimeService({ bus, users }) {
  function visibleTo(user, { event, data }) {
    if (event.startsWith('notification.')) return data?.user_id === user.id;
    if (isAdmin(user)) return true;
    if (data?.inbox_id === undefined) return true; // contacts, labels, presence
    return users.memberInboxIds(user.id).includes(data.inbox_id);
  }
  return {
    /** Subscribes `send` to the events this user may see; returns the unsubscribe function. */
    stream(user, send) {
      return bus.subscribe((envelope) => {
        if (visibleTo(user, envelope)) send(envelope);
      });
    },
  };
}
