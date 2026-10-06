import { iso, updateFields } from './sql.mjs';

const parseRule = (row) =>
  row ? { ...row, conditions: JSON.parse(row.conditions), actions: JSON.parse(row.actions) } : null;
const parseWebhook = (row) => (row ? { ...row, subscriptions: JSON.parse(row.subscriptions) } : null);

/** Outgoing webhooks (with a durable delivery queue) and automation rules. */
export function automationStore(db) {
  const webhook = (id) => parseWebhook(db.prepare('SELECT * FROM webhooks WHERE id=?').get(id));
  const rule = (id) => parseRule(db.prepare('SELECT * FROM automation_rules WHERE id=?').get(id));
  return {
    webhooks: () => db.prepare('SELECT * FROM webhooks ORDER BY id').all().map(parseWebhook),
    webhook,
    createWebhook({ url, subscriptions, inbox_id = null, secret }) {
      const { lastInsertRowid } = db
        .prepare('INSERT INTO webhooks(url,subscriptions,inbox_id,secret,created) VALUES(?,?,?,?,?)')
        .run(url, JSON.stringify(subscriptions), inbox_id, secret, iso());
      return webhook(Number(lastInsertRowid));
    },
    updateWebhook(id, fields) {
      const values = { ...fields };
      if (fields.subscriptions) values.subscriptions = JSON.stringify(fields.subscriptions);
      updateFields(db, 'webhooks', id, values, ['url', 'subscriptions', 'inbox_id', 'active']);
      return webhook(id);
    },
    deleteWebhook: (id) => db.prepare('DELETE FROM webhooks WHERE id=?').run(id),

    enqueueDelivery: (webhookId, event, payload, now) =>
      db
        .prepare(
          'INSERT INTO webhook_deliveries(webhook_id,event,payload,next_attempt_at,created_at) VALUES(?,?,?,?,?)',
        )
        .run(webhookId, event, JSON.stringify(payload), now, now),
    dueDeliveries: (now, limit = 20) =>
      db
        .prepare(
          `SELECT d.*, w.url, w.secret FROM webhook_deliveries d JOIN webhooks w ON w.id=d.webhook_id
           WHERE d.status='pending' AND d.next_attempt_at<=? AND w.active=1 ORDER BY d.id LIMIT ?`,
        )
        .all(now, limit),
    recordAttempt: (id, { status, attempts, nextAttemptAt, responseStatus, error }) =>
      db
        .prepare(
          'UPDATE webhook_deliveries SET status=?,attempts=?,next_attempt_at=?,response_status=?,last_error=? WHERE id=?',
        )
        .run(status, attempts, nextAttemptAt, responseStatus ?? null, error ?? null, id),
    deliveries: (webhookId, limit = 20) =>
      db
        .prepare(
          'SELECT id,event,status,attempts,response_status,last_error,created_at FROM webhook_deliveries WHERE webhook_id=? ORDER BY id DESC LIMIT ?',
        )
        .all(webhookId, limit),

    automationRules: () => db.prepare('SELECT * FROM automation_rules ORDER BY id').all().map(parseRule),
    activeRules: (eventName) =>
      db
        .prepare('SELECT * FROM automation_rules WHERE active=1 AND event_name=? ORDER BY id')
        .all(eventName)
        .map(parseRule),
    automationRule: rule,
    createRule({ name, description, event_name, conditions, actions, active = true }) {
      const { lastInsertRowid } = db
        .prepare(
          'INSERT INTO automation_rules(name,description,event_name,conditions,actions,active,created) VALUES(?,?,?,?,?,?,?)',
        )
        .run(
          name,
          description ?? null,
          event_name,
          JSON.stringify(conditions),
          JSON.stringify(actions),
          Number(active),
          iso(),
        );
      return rule(Number(lastInsertRowid));
    },
    updateRule(id, fields) {
      const values = { ...fields };
      for (const key of ['conditions', 'actions']) if (fields[key]) values[key] = JSON.stringify(fields[key]);
      updateFields(db, 'automation_rules', id, values, [
        'name',
        'description',
        'event_name',
        'conditions',
        'actions',
        'active',
      ]);
      return rule(id);
    },
    deleteRule: (id) => db.prepare('DELETE FROM automation_rules WHERE id=?').run(id),
  };
}
