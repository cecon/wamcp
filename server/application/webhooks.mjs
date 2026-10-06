import { HelpdeskError, requireAdmin } from '../domain/helpdesk.mjs';
import { MAX_ATTEMPTS, retryDelay, validateWebhook, webhookEventFor } from '../domain/webhooks.mjs';

/**
 * Outgoing webhooks: events are queued durably in SQLite and delivered by `deliverDue`
 * (called on a timer) with exponential retries, so a slow receiver never blocks a use case.
 */
export function webhookService({ helpdesk, sender, bus, now = () => Math.floor(Date.now() / 1000) }) {
  let delivering = false;
  const find = (id) => {
    const webhook = helpdesk.webhook(id);
    if (!webhook) throw new HelpdeskError('Webhook não encontrado', 404);
    return webhook;
  };
  function validate(fields) {
    validateWebhook(fields);
    if (fields.inbox_id && !helpdesk.inbox(fields.inbox_id))
      throw new HelpdeskError('Caixa de entrada não encontrada', 422);
  }
  function enqueue({ event, data, performer }) {
    const name = webhookEventFor(event);
    if (!name) return;
    for (const webhook of helpdesk.webhooks()) {
      if (!webhook.active || !webhook.subscriptions.includes(name)) continue;
      if (webhook.inbox_id && data?.inbox_id !== webhook.inbox_id) continue;
      helpdesk.enqueueDelivery(webhook.id, name, { event: name, data, performer, timestamp: now() }, now());
    }
  }
  return {
    listen: () => bus.subscribe(enqueue),
    async deliverDue() {
      if (delivering) return;
      delivering = true;
      try {
        for (const delivery of helpdesk.dueDeliveries(now())) {
          const attempts = delivery.attempts + 1;
          let result = { ok: false, status: null },
            error = null;
          try {
            result = await sender.post(delivery.url, JSON.parse(delivery.payload), delivery.secret);
            if (!result.ok) error = `HTTP ${result.status}`;
          } catch (e) {
            error = e?.name === 'TimeoutError' ? 'Tempo esgotado' : 'Falha de conexão';
          }
          const delay = retryDelay(attempts);
          helpdesk.recordAttempt(delivery.id, {
            status: result.ok ? 'sent' : attempts >= MAX_ATTEMPTS || delay === null ? 'failed' : 'pending',
            attempts,
            nextAttemptAt: result.ok || delay === null ? now() : now() + delay,
            responseStatus: result.status,
            error,
          });
        }
      } finally {
        delivering = false;
      }
    },

    list(actor) {
      requireAdmin(actor);
      return helpdesk.webhooks();
    },
    create(actor, fields) {
      requireAdmin(actor);
      validate(fields);
      return helpdesk.createWebhook({ ...fields, secret: sender.secret() });
    },
    update(actor, id, fields) {
      requireAdmin(actor);
      const current = find(id);
      validate({ ...current, ...fields });
      return helpdesk.updateWebhook(id, fields);
    },
    remove(actor, id) {
      requireAdmin(actor);
      find(id);
      helpdesk.deleteWebhook(id);
    },
    deliveries(actor, id) {
      requireAdmin(actor);
      find(id);
      return helpdesk.deliveries(id);
    },
  };
}
