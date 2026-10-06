import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { eventStore } from '../server/adapters/outbound/sqlite/event-store.mjs';
import { eventService } from '../server/application/events.mjs';
import { EVENT_TTL, ROTATION_WINDOW } from '../server/domain/events.mjs';

const jid = '5511999999999@s.whatsapp.net';
const otherJid = '5511888888888@s.whatsapp.net';
const secret = `whsec_${Buffer.alloc(32, 1).toString('base64')}`;
const nextSecret = `whsec_${Buffer.alloc(32, 2).toString('base64')}`;
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

test('events catalog and strict bounded subscription validation', async (t) => {
  const f = fixture(t);
  assert.equal(f.service.list().events[0].name, 'message.created');
  const invalid = [
    { name: 'other' },
    { arguments: null },
    { arguments: { sessionId: 'two' } },
    { arguments: { jid: 'status@broadcast' } },
    { cursor: 'replay' },
    { ttlMs: 0 },
    { ttlMs: -1 },
    { ttlMs: 1.5 },
    { delivery: { mode: 'polling' } },
    { delivery: { mode: 'webhook', url: 'http://receiver.example', secret } },
    { delivery: { mode: 'webhook', url: 'https://user:password@receiver.example', secret } },
    { delivery: { mode: 'webhook', url: 'https://receiver.example', secret: 'whsec_AA==' } },
  ];
  for (const value of invalid)
    await assert.rejects(f.service.subscribe(owner, params(value)), { code: -32602 });
  assert.equal(f.verified.length, 0);
  await assert.rejects(f.service.subscribe({ ...owner, principalKind: 'unknown' }, params()), {
    code: -32001,
  });
});

test('deterministic subscriptions refresh expiry, cache verification and rotate secrets', async (t) => {
  const f = fixture(t);
  const first = await f.service.subscribe(owner, params({ ttlMs: 5000 }));
  const same = await f.service.subscribe(owner, params({ ttlMs: null }));
  assert.equal(first.id, same.id);
  assert.equal(Date.parse(same.refreshBefore) - Date.parse(first.refreshBefore), EVENT_TTL - 5000);
  assert.equal(f.verified.length, 1);
  const rotated = params({ delivery: { ...params().delivery, secret: nextSecret } });
  await f.service.subscribe(owner, rotated);
  assert.equal(f.verified.length, 2);
  const stored = f.repository.get(first.id);
  assert.equal(stored.previousSecret, secret);
  assert.equal(stored.secret, nextSecret);
  f.service.publish(owner.sessionId, incoming());
  await f.service.flush();
  assert.equal(f.delivered[0].subscription.previousSecret, secret);
  f.advance(ROTATION_WINDOW + 1);
  await f.service.flush();
  assert.equal(f.repository.get(first.id).previousSecret, undefined);
  await f.service.subscribe(owner, rotated);
  assert.equal(f.verified.length, 3);
});

test('filtering, owner/session isolation, outgoing suppression and truncation', async (t) => {
  const f = fixture(t);
  await f.service.subscribe(owner, params({ arguments: { jid } }));
  await f.service.subscribe({ ...owner, sessionId: 'two' }, params());
  await f.service.subscribe({ ...owner, principalId: 'other' }, params({ arguments: { jid: otherJid } }));
  assert.equal(f.service.publish('one', incoming('sent', { from_me: true })), 0);
  assert.equal(f.service.publish('one', incoming('missing-origin', { from_me: undefined })), 0);
  assert.equal(f.service.publish('one', incoming('status', { jid: 'status@broadcast' })), 0);
  assert.equal(f.service.publish('one', incoming('long', { body: 'a'.repeat(10000) })), 1);
  await f.service.flush();
  const { subscription, event } = f.delivered[0];
  assert.equal(subscription.sessionId, 'one');
  assert.equal(subscription.principalId, 'reader');
  assert.equal(event.data.text.length, 8000);
  assert.equal(event.data.truncated, true);
  assert.equal(event.timestamp, '1970-01-01T00:01:40.000Z');
  assert.equal(event.cursor, null);
  assert.equal(f.delivered.length, 1);
  await f.service.unsubscribe({ ...owner, principalId: 'other' }, params({ arguments: { jid } }));
  assert.equal(f.repository.list('one').length, 2);
  await f.service.unsubscribe(owner, params({ arguments: { jid } }));
  await f.service.unsubscribe(owner, params({ arguments: { jid } }));
  assert.equal(f.repository.list('one').length, 1);
});

test('subscriptions, pending delivery, stable event IDs and receipts survive restart', async (t) => {
  let status = 503;
  const f = fixture(t, { deliver: async () => ({ status }) });
  const subscription = await f.service.subscribe(owner, params());
  assert.equal(f.service.publish('one', incoming()), 1);
  assert.equal(f.service.publish('one', incoming()), 0);
  await f.service.flush();
  const eventId = f.delivered[0].event.eventId;
  assert.equal(f.repository.pending(), 1);
  await f.reopen();
  assert.equal(f.repository.get(subscription.id).secret, secret);
  status = 204;
  f.advance(1000);
  await f.service.flush();
  assert.equal(f.delivered[1].event.eventId, eventId);
  assert.equal(f.repository.pending(), 0);
  await f.reopen();
  assert.equal(f.service.publish('one', incoming()), 0);
});

test('expiration, revocation and disconnect purge subscriptions and queued payloads', async (t) => {
  const f = fixture(t);
  await f.service.subscribe(owner, params({ ttlMs: 10 }));
  f.service.publish('one', incoming());
  f.advance(10);
  await f.service.flush();
  assert.equal(f.repository.pending(), 0);
  assert.equal(f.repository.list().length, 0);
  await f.service.subscribe(owner, params());
  f.service.publish('one', incoming());
  f.revoked.add('one/reader');
  await f.service.flush();
  assert.equal(f.repository.pending(), 0);
  assert.equal(f.repository.list().length, 0);
  assert.equal(f.delivered.length, 0);
  f.revoked.clear();
  await f.service.subscribe(owner, params());
  f.service.publish('one', incoming());
  f.service.disconnect('one');
  assert.equal(f.repository.pending(), 0);
  assert.equal(f.repository.list().length, 0);
});

test('verification failure does not activate subscription or expose callback details', async (t) => {
  const f = fixture(t, {
    verify: async () => {
      throw new Error('secret provider detail');
    },
  });
  await assert.rejects(f.service.subscribe(owner, params()), (error) => {
    assert.equal(error.code, -32015);
    assert.deepEqual(error.data, { reason: 'challenge_failed' });
    assert.doesNotMatch(error.message, /secret provider detail/);
    return true;
  });
  assert.equal(f.repository.list().length, 0);
});

test('revocation and disconnect during verification cannot activate a subscription', async (t) => {
  for (const action of ['revoke', 'disconnect']) {
    let resolve;
    const f = fixture(t, {
      verify: () =>
        new Promise((done) => {
          resolve = done;
        }),
    });
    const pending = f.service.subscribe(owner, params());
    await tick();
    if (action === 'revoke') f.revoked.add('one/reader');
    else f.service.disconnect('one');
    resolve();
    await assert.rejects(pending, { code: -32001 });
    assert.equal(f.repository.list().length, 0);
  }
});

test('unsubscribe is serialized behind concurrent verification and remains idempotent', async (t) => {
  let resolve;
  const f = fixture(t, {
    verify: () =>
      new Promise((done) => {
        resolve = done;
      }),
  });
  const pending = f.service.subscribe(owner, params());
  const removal = f.service.unsubscribe(owner, params());
  await tick();
  resolve();
  await pending;
  assert.deepEqual(await removal, {});
  assert.equal(f.repository.list().length, 0);
});
