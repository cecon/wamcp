import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { eventStore } from '../server/adapters/outbound/sqlite/event-store.mjs';
import { eventService } from '../server/application/events.mjs';
import { EVENT_TTL } from '../server/domain/events.mjs';

const jid = '5511999999999@s.whatsapp.net';
const secret = `whsec_${Buffer.alloc(32, 1).toString('base64')}`;
const owner = { sessionId: 'one', principalId: 'reader', principalKind: 'token' };
const params = (extra = {}) => ({
  name: 'message.created',
  arguments: {},
  delivery: { mode: 'webhook', url: 'https://receiver.example/events', secret },
  ...extra,
});
const incoming = (id = 'message', extra = {}) => ({
  jid,
  id,
  sender: 'Alice',
  body: 'Hello',
  kind: 'conversation',
  from_me: false,
  ts: 100,
  ...extra,
});
const tick = () => new Promise((resolve) => setImmediate(resolve));

function fixture(t, webhook = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'wamcp-events-'));
  let db;
  let repository;
  let service;
  let time = 1700000000000;
  const revoked = new Set();
  const verified = [];
  const delivered = [];
  function open() {
    db = new DatabaseSync(path.join(dir, 'events.sqlite'));
    db.exec(
      "PRAGMA foreign_keys=ON; CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY); INSERT OR IGNORE INTO sessions VALUES('one'),('two')",
    );
    repository = eventStore(db);
    service = eventService(
      repository,
      {
        verify: async (subscription) => {
          verified.push(subscription);
          return webhook.verify?.(subscription);
        },
        deliver: async (subscription, event) => {
          delivered.push({ subscription, event });
          return webhook.deliver ? webhook.deliver(subscription, event) : { status: 204 };
        },
      },
      { authorize: (sessionId, principalId) => !revoked.has(`${sessionId}/${principalId}`), now: () => time },
    );
  }
  open();
  t.after(async () => {
    await service.close();
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return {
    get service() {
      return service;
    },
    get repository() {
      return repository;
    },
    get db() {
      return db;
    },
    verified,
    delivered,
    revoked,
    advance: (amount) => {
      time += amount;
    },
    async reopen() {
      await service.close();
      db.close();
      open();
    },
  };
}

test('delivery response policy retries only transient failures with bounded attempts', async (t) => {
  for (const status of [204, 400, 401, 403, 404, 410, 413, 429, 500, 503, 0]) {
    const f = fixture(t, {
      deliver: async () => {
        if (status === 0) throw new Error('network');
        return { status };
      },
    });
    await f.service.subscribe(owner, params());
    f.service.publish('one', incoming());
    await f.service.flush();
    const transient = [0, 429, 500, 503].includes(status);
    assert.equal(f.repository.pending(), transient ? 1 : 0, `status ${status}`);
    assert.equal(f.repository.list().length, status === 410 ? 0 : 1);
    const first = f.repository.diagnostics('one')[0];
    assert.equal(first.attempt, 1);
    assert.equal(first.status, status);
    assert.equal(
      first.outcome,
      status === 204 ? 'delivered' : status === 410 ? 'disabled' : transient ? 'retry' : 'discarded',
    );
    await f.service.flush();
    assert.equal(f.delivered.length, 1);
    if (transient) {
      for (let attempt = 1; attempt < 8; attempt++) {
        f.advance(1000 * 2 ** (attempt - 1));
        await f.service.flush();
      }
      assert.equal(f.delivered.length, 8);
      assert.equal(f.repository.pending(), 0);
      assert.equal(f.repository.diagnostics('one')[0].attempt, 8);
      assert.equal(f.repository.diagnostics('one')[0].outcome, 'discarded');
      assert.equal(new Set(f.delivered.map(({ event }) => event.eventId)).size, 1);
    }
  }
});

test('subscription TTL is finite and capped; expired queued data is not revived by refresh', async (t) => {
  const f = fixture(t);
  const long = await f.service.subscribe(owner, params({ ttlMs: EVENT_TTL * 10 }));
  const finite = await f.service.subscribe(owner, params({ ttlMs: null }));
  assert.equal(long.refreshBefore, finite.refreshBefore);
  assert.notEqual(finite.refreshBefore, null);
  f.service.publish('one', incoming());
  f.advance(EVENT_TTL);
  await f.service.subscribe(owner, params());
  await f.service.flush();
  assert.equal(f.repository.pending(), 0);
  assert.equal(f.delivered.length, 0);
});

test('queue and owner limits are bounded and overflow has sanitized diagnostics', async (t) => {
  const f = fixture(t);
  await f.service.subscribe(owner, params());
  for (let index = 0; index < 1000; index++)
    assert.equal(f.service.publish('one', incoming(`id${index}`)), 1);
  assert.equal(f.service.publish('one', incoming('overflow')), 0);
  assert.equal(f.repository.pending(), 1000);
  const diagnostic = f.repository.diagnostics('one')[0];
  assert.equal(diagnostic.outcome, 'queue_full');
  assert.equal(diagnostic.attempt, 0);
  assert.doesNotMatch(JSON.stringify(diagnostic), /whsec|receiver.example|Alice|Hello/);
  assert.deepEqual(f.repository.diagnostics('two'), []);
  for (let index = 1; index < 50; index++)
    await f.service.subscribe(
      owner,
      params({ delivery: { ...params().delivery, url: `https://receiver.example/${index}` } }),
    );
  await assert.rejects(
    f.service.subscribe(
      owner,
      params({ delivery: { ...params().delivery, url: 'https://receiver.example/overflow' } }),
    ),
    /Limite/,
  );
  assert.equal(f.repository.list().length, 50);
});

test('concurrent flushes share a batch; independent callbacks progress with bounded concurrency', async (t) => {
  const blocked = [];
  let active = 0;
  let maxActive = 0;
  const f = fixture(t, {
    deliver: async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => blocked.push(resolve));
      active--;
      return { status: 204 };
    },
  });
  for (let index = 0; index < 6; index++)
    await f.service.subscribe({ ...owner, principalId: `reader${index}` }, params());
  f.service.publish('one', incoming());
  const flush = f.service.flush();
  assert.equal(f.service.flush(), flush);
  await tick();
  assert.equal(active, 4);
  for (const resolve of blocked.splice(0)) resolve();
  await tick();
  assert.equal(active, 2);
  for (const resolve of blocked.splice(0)) resolve();
  await flush;
  assert.equal(maxActive, 4);
  assert.equal(f.delivered.length, 6);
});

test('shutdown waits for in-flight delivery, preserves unsent queue, and rejects new work', async (t) => {
  let resolve;
  const f = fixture(t, {
    deliver: () =>
      new Promise((done) => {
        resolve = done;
      }),
  });
  await f.service.subscribe(owner, params());
  for (let index = 0; index < 5; index++) f.service.publish('one', incoming(`id${index}`));
  const flush = f.service.flush();
  await tick();
  const closing = f.service.close();
  assert.equal(f.service.publish('one', incoming('later')), 0);
  resolve({ status: 204 });
  await closing;
  await flush;
  assert.equal(f.delivered.length, 1);
  assert.equal(f.repository.pending(), 4);
  await assert.rejects(f.service.subscribe(owner, params()), { code: -32001 });
});

test('active refresh atomically extends queued delivery beyond the original expiry', async (t) => {
  const f = fixture(t);
  const original = await f.service.subscribe(owner, params({ ttlMs: 10000 }));
  f.service.publish('one', incoming());
  f.advance(9000);
  const refreshed = await f.service.subscribe(owner, params({ ttlMs: 10000 }));
  assert.equal(refreshed.id, original.id);
  const pendingExpiry = f.db.prepare('SELECT expires FROM event_queue').get().expires;
  assert.equal(pendingExpiry, Date.parse(refreshed.refreshBefore));
  f.advance(2000);
  await f.service.flush();
  assert.equal(f.delivered.length, 1);
  assert.equal(f.repository.pending(), 0);
});

test('a slow subscription backlog occupies at most one callback in each batch', async (t) => {
  let resolve;
  const f = fixture(t, {
    deliver: async (subscription) => {
      if (subscription.principalId === 'reader')
        await new Promise((done) => {
          resolve = done;
        });
      return { status: 204 };
    },
  });
  await f.service.subscribe(owner, params({ arguments: { jid } }));
  for (let index = 0; index < 100; index++) f.service.publish('one', incoming(`slow${index}`));
  const first = f.service.flush();
  await tick();
  const fastJid = '5511888888888@s.whatsapp.net';
  await f.service.subscribe({ ...owner, principalId: 'fast' }, params({ arguments: { jid: fastJid } }));
  f.service.publish('one', incoming('fast', { jid: fastJid }));
  resolve();
  await first;
  assert.equal(f.delivered.length, 1);
  const second = f.service.flush();
  await tick();
  assert.ok(f.delivered.some(({ subscription }) => subscription.principalId === 'fast'));
  resolve();
  await second;
  assert.equal(f.delivered.filter(({ subscription }) => subscription.principalId === 'reader').length, 2);
});
