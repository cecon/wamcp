import { HelpdeskError } from './helpdesk.mjs';

/** Chatwoot webhook event names and the internal events that produce them. */
export const WEBHOOK_EVENTS = {
  conversation_created: ['conversation.created'],
  conversation_status_changed: ['conversation.status_changed'],
  conversation_updated: ['conversation.updated', 'assignee.changed', 'team.changed'],
  message_created: ['message.created'],
  message_updated: ['message.updated'],
  contact_created: ['contact.created'],
  contact_updated: ['contact.updated'],
  csat_created: ['csat.created'],
};

export function webhookEventFor(event) {
  return Object.keys(WEBHOOK_EVENTS).find((name) => WEBHOOK_EVENTS[name].includes(event)) || null;
}

/** Retry schedule after a failed delivery: 30s, 2min, 10min, 1h; then the delivery is marked failed. */
const BACKOFF = [30, 120, 600, 3600];
export const MAX_ATTEMPTS = BACKOFF.length + 1;
export const retryDelay = (attempts) => BACKOFF[attempts - 1] ?? null;

export function validateWebhook({ url, subscriptions }) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new HelpdeskError('URL inválida');
  }
  if (!['https:', 'http:'].includes(parsed.protocol)) throw new HelpdeskError('Use uma URL http(s)');
  if (parsed.username || parsed.password) throw new HelpdeskError('Não inclua credenciais na URL');
  if (!subscriptions.length || subscriptions.some((s) => !WEBHOOK_EVENTS[s]))
    throw new HelpdeskError('Escolha eventos válidos');
}
