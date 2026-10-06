import { requireAdmin } from '../domain/helpdesk.mjs';

const DAY = 86400;

/**
 * Reporting (Chatwoot's ReportingEventListener + reports API): first response and resolution
 * times are recorded as events when they happen, then aggregated per period, inbox and agent.
 */
export function reportService({ helpdesk, bus, now = () => Math.floor(Date.now() / 1000) }) {
  function onEvent({ event, data }) {
    if (
      event === 'message.created' &&
      data.message_type === 'outgoing' &&
      !data.private &&
      (data.sender_type === 'user' || data.sender_type === 'agent_bot')
    ) {
      const firstIncoming = helpdesk.firstIncomingAt(data.conversation_id);
      if (firstIncoming == null || data.created_at < firstIncoming) return;
      helpdesk.recordEvent({
        name: 'first_response',
        value: data.created_at - firstIncoming,
        userId: data.sender_type === 'user' ? data.sender_id : null,
        inboxId: data.inbox_id,
        conversationId: data.conversation_id,
        createdAt: data.created_at,
      });
    } else if (event === 'conversation.status_changed' && data.status === 'resolved') {
      const start = helpdesk.firstIncomingAt(data.id) ?? Math.floor(Date.parse(data.created) / 1000);
      helpdesk.recordEvent({
        name: 'conversation_resolved',
        value: Math.max(0, now() - start),
        userId: data.assignee_id,
        inboxId: data.inbox_id,
        conversationId: data.id,
        createdAt: now(),
      });
    }
  }
  /** Defaults to the last 7 days including the current second; `until` is exclusive. */
  const period = ({ since, until, inbox_id }) => {
    const end = until ?? now() + 1;
    return [since ?? end - 7 * DAY, end, inbox_id ?? null];
  };
  return {
    listen: () => bus.subscribe(onEvent),
    summary(actor, filters) {
      requireAdmin(actor);
      return helpdesk.summary(...period(filters));
    },
    agents(actor, filters) {
      requireAdmin(actor);
      return helpdesk.agentReport(...period(filters));
    },
    csat(actor, filters) {
      requireAdmin(actor);
      return helpdesk.csatResponses(...period(filters));
    },
  };
}
