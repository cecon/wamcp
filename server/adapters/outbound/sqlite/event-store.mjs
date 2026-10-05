import { createHash } from 'node:crypto';

const MAX_SUBSCRIPTIONS = 1000;
const MAX_OWNER_SUBSCRIPTIONS = 50;
const MAX_QUEUE = 10000;
const MAX_SUBSCRIPTION_QUEUE = 1000;
const MAX_RECEIPTS = 50000;

export function eventStore(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS event_subscriptions(
      id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      principal_id TEXT NOT NULL, principal_kind TEXT NOT NULL, expires INTEGER NOT NULL, value TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS event_subscription_owner ON event_subscriptions(session_id,principal_kind,principal_id);
    CREATE TABLE IF NOT EXISTS event_queue(
      subscription_id TEXT NOT NULL REFERENCES event_subscriptions(id) ON DELETE CASCADE,
      event_id TEXT NOT NULL, event TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt INTEGER NOT NULL, expires INTEGER NOT NULL, PRIMARY KEY(subscription_id,event_id)
    );
    CREATE INDEX IF NOT EXISTS event_queue_due ON event_queue(next_attempt);
    CREATE TABLE IF NOT EXISTS event_receipts(
      subscription_id TEXT NOT NULL REFERENCES event_subscriptions(id) ON DELETE CASCADE,
      event_id TEXT NOT NULL, expires INTEGER NOT NULL, PRIMARY KEY(subscription_id,event_id)
    );
    CREATE TABLE IF NOT EXISTS event_attempts(
      id INTEGER PRIMARY KEY, session_id TEXT NOT NULL, subscription_id TEXT NOT NULL,
      event_id TEXT NOT NULL, attempt INTEGER NOT NULL, status INTEGER NOT NULL,
      outcome TEXT NOT NULL, at INTEGER NOT NULL
    );
  `);
  const query = (sql, ...args) => db.prepare(sql).all(...args);
  const run = (sql, ...args) => db.prepare(sql).run(...args);
  const count = (table) => db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count;
  return {
    hash: (value) => createHash('sha256').update(value).digest('hex'),
    now: () => Date.now(),
    get(id) {
      const row = db.prepare('SELECT value FROM event_subscriptions WHERE id=?').get(id);
      return row ? JSON.parse(row.value) : null;
    },
    list(sessionId) {
      const rows =
        sessionId === undefined
          ? query('SELECT value FROM event_subscriptions')
          : query('SELECT value FROM event_subscriptions WHERE session_id=?', sessionId);
      return rows.map((row) => JSON.parse(row.value));
    },
    save(subscription) {
      const { id, sessionId, principalId, principalKind, expires } = subscription;
      if (!this.get(id)) {
        const ownerCount = db
          .prepare(
            'SELECT COUNT(*) AS count FROM event_subscriptions WHERE session_id=? AND principal_id=? AND principal_kind=?',
          )
          .get(sessionId, principalId, principalKind).count;
        if (count('event_subscriptions') >= MAX_SUBSCRIPTIONS || ownerCount >= MAX_OWNER_SUBSCRIPTIONS)
          throw new Error('Limite de assinaturas de eventos atingido');
      }
      db.exec('SAVEPOINT save_event_subscription');
      try {
        run(
          `INSERT INTO event_subscriptions VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET expires=excluded.expires,value=excluded.value`,
          id,
          sessionId,
          principalId,
          principalKind,
          expires,
          JSON.stringify(subscription),
        );
        run('UPDATE event_queue SET expires=? WHERE subscription_id=?', expires, id);
        db.exec('RELEASE save_event_subscription');
      } catch (error) {
        db.exec('ROLLBACK TO save_event_subscription; RELEASE save_event_subscription');
        throw error;
      }
    },
    remove(id) {
      run('DELETE FROM event_subscriptions WHERE id=?', id);
    },
    removeSession(sessionId) {
      run('DELETE FROM event_subscriptions WHERE session_id=?', sessionId);
    },
    prune(now) {
      run('DELETE FROM event_subscriptions WHERE expires<=?', now);
      run('DELETE FROM event_queue WHERE expires<=?', now);
      run('DELETE FROM event_receipts WHERE expires<=?', now);
      run('DELETE FROM event_attempts WHERE at<=?', now - 86400000);
      for (const subscription of this.list()) {
        if (subscription.previousSecret && subscription.rotateUntil <= now) {
          delete subscription.previousSecret;
          delete subscription.rotateUntil;
          this.save(subscription);
        }
      }
    },
    enqueue(subscription, event, now) {
      if (!this.get(subscription.id)) return false;
      const seen = db
        .prepare('SELECT 1 FROM event_receipts WHERE subscription_id=? AND event_id=?')
        .get(subscription.id, event.eventId);
      if (seen || this.hasPending({ subscriptionId: subscription.id, eventId: event.eventId })) return false;
      const pending = db
        .prepare('SELECT COUNT(*) AS count FROM event_queue WHERE subscription_id=?')
        .get(subscription.id).count;
      if (pending >= MAX_SUBSCRIPTION_QUEUE || count('event_queue') >= MAX_QUEUE) {
        this.record(
          { subscriptionId: subscription.id, eventId: event.eventId, attempts: -1 },
          0,
          'queue_full',
          now,
        );
        return false;
      }
      db.exec('SAVEPOINT enqueue_event');
      try {
        run(
          'INSERT INTO event_queue(subscription_id,event_id,event,next_attempt,expires) VALUES(?,?,?,?,?)',
          subscription.id,
          event.eventId,
          JSON.stringify(event),
          now,
          subscription.expires,
        );
        run('INSERT INTO event_receipts VALUES(?,?,?)', subscription.id, event.eventId, now + 86400000);
        const extra = count('event_receipts') - MAX_RECEIPTS;
        if (extra > 0)
          run(
            'DELETE FROM event_receipts WHERE rowid IN (SELECT rowid FROM event_receipts ORDER BY expires LIMIT ?)',
            extra,
          );
        db.exec('RELEASE enqueue_event');
        return true;
      } catch (error) {
        db.exec('ROLLBACK TO enqueue_event; RELEASE enqueue_event');
        throw error;
      }
    },
    due(now, limit = 20) {
      return query(
        `SELECT * FROM (SELECT *,ROW_NUMBER() OVER(PARTITION BY subscription_id ORDER BY next_attempt,event_id) AS position
         FROM event_queue WHERE next_attempt<=? AND expires>?) WHERE position=1 ORDER BY next_attempt,event_id LIMIT ?`,
        now,
        now,
        limit,
      ).map((row) => ({
        subscriptionId: row.subscription_id,
        eventId: row.event_id,
        event: JSON.parse(row.event),
        attempts: row.attempts,
      }));
    },
    hasPending(item) {
      return Boolean(
        db
          .prepare('SELECT 1 FROM event_queue WHERE subscription_id=? AND event_id=?')
          .get(item.subscriptionId, item.eventId),
      );
    },
    retry(item, nextAttempt) {
      run(
        'UPDATE event_queue SET attempts=attempts+1,next_attempt=? WHERE subscription_id=? AND event_id=?',
        nextAttempt,
        item.subscriptionId,
        item.eventId,
      );
    },
    finish(item) {
      run(
        'DELETE FROM event_queue WHERE subscription_id=? AND event_id=?',
        item.subscriptionId,
        item.eventId,
      );
    },
    record(item, status, outcome, now) {
      const subscription = this.get(item.subscriptionId);
      if (!subscription) return;
      run(
        'INSERT INTO event_attempts(session_id,subscription_id,event_id,attempt,status,outcome,at) VALUES(?,?,?,?,?,?,?)',
        subscription.sessionId,
        subscription.id,
        item.eventId,
        item.attempts + 1,
        Number.isInteger(status) && status >= 0 && status <= 599 ? status : 0,
        outcome,
        now,
      );
      run(
        'DELETE FROM event_attempts WHERE id NOT IN (SELECT id FROM event_attempts ORDER BY id DESC LIMIT 1000)',
      );
    },
    diagnostics(sessionId) {
      return query(
        'SELECT subscription_id,event_id,attempt,status,outcome,at FROM event_attempts WHERE session_id=? ORDER BY id DESC LIMIT 100',
        sessionId,
      );
    },
    pending: () => count('event_queue'),
  };
}
