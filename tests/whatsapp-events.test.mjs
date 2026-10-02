import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openStore } from '../server/adapters/outbound/sqlite/store.mjs';
import { persistLiveMessages } from '../server/adapters/outbound/whatsapp-events.mjs';
import { sessionService } from '../server/application/sessions.mjs';
import { proto } from '@whiskeysockets/baileys';
const jid = '5511999999999@s.whatsapp.net';
const message = (id, overrides = {}) => ({
  key: { id, remoteJid: jid },
  message: { conversation: 'New message' },
  messageTimestamp: 100,
  ...overrides,
});
test('WhatsApp only publishes new incoming notify messages, never history or outbound echoes', (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'wamcp-wa-events-'));
  const store = openStore(dir),
    session = store.createSession('Events'),
    published = [];
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const receive = (messages, type = 'notify') =>
    persistLiveMessages(store, session.id, { messages, type }, (...args) => published.push(args));
  store.message(session.id, message('history'));
  receive([message('history'), message('new')]);
  receive([message('new')]);
  receive([message('offline')], 'append');
  receive([message('own', { key: { id: 'own', remoteJid: jid, fromMe: true } })]);
  receive([message('status', { key: { id: 'status', remoteJid: 'status@broadcast' } })]);
  receive([message('control', { message: { protocolMessage: { type: 0 } } })]);
  assert.equal(published.length, 1);
  assert.equal(published[0][0], session.id);
  assert.equal(published[0][1].id, 'new');
  assert.equal(published[0][1].from_me, false);
  assert.equal(store.messages(session.id, jid).length, 5);
});
test('live message deduplication is scoped to its WhatsApp session', (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'wamcp-wa-isolation-'));
  const store = openStore(dir),
    a = store.createSession('A'),
    b = store.createSession('B');
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  assert.equal(store.message(a.id, message('same')).id, 'same');
  assert.equal(store.message(b.id, message('same')).id, 'same');
  assert.equal(store.message(a.id, message('same')), undefined);
});
test('explicit disconnect clears subscriptions before disconnecting WhatsApp', () => {
  const calls = [];
  const service = sessionService(
    { session: (id) => ({ id }) },
    { stop: (id, logout) => calls.push(['stop', id, logout]) },
    { disconnect: (id) => calls.push(['events', id]) },
  );
  service.stop('session', true);
  assert.deepEqual(calls, [
    ['events', 'session'],
    ['stop', 'session', true],
  ]);
});

test('group content bundled with sender-key distribution is published, key-only control is not', (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'wamcp-group-events-'));
  const store = openStore(dir),
    session = store.createSession('Group'),
    published = [];
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const control = { groupId: '123456@g.us', axolotlSenderKeyDistributionMessage: Buffer.from([1]) };
  const bundled = proto.Message.decode(
    proto.Message.encode(
      proto.Message.fromObject({
        senderKeyDistributionMessage: control,
        imageMessage: { caption: 'Please review this', mimetype: 'image/jpeg' },
      }),
    ).finish(),
  );
  persistLiveMessages(
    store,
    session.id,
    {
      type: 'notify',
      messages: [
        message('group-image', { key: { id: 'group-image', remoteJid: '123456@g.us' }, message: bundled }),
        message('key-only', { message: { senderKeyDistributionMessage: control } }),
      ],
    },
    (_id, saved) => published.push(saved),
  );
  assert.equal(published.length, 1);
  assert.equal(published[0].kind, 'imageMessage');
  assert.equal(published[0].body, 'Please review this');
});
