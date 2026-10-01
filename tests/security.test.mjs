import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openStore } from '../server/adapters/outbound/sqlite/store.mjs';
import { createApps } from '../server/adapters/inbound/http.mjs';
import { sessionService } from '../server/application/sessions.mjs';
import { mcpService } from '../server/application/mcp.mjs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

async function fixture(t) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'wamcp-test-'));
  const store = openStore(dir),
    sent = [];
  const wa = {
    detail: () => ({ qr: null }),
    connect: async () => {},
    stop: async () => {},
    send: async (...args) => {
      sent.push(args);
      return { id: 'sent' };
    },
  };
  const apps = createApps({
    sessions: sessionService(store, wa),
    mcp: mcpService(store, wa),
    adminToken: 'a'.repeat(64),
  });
  const servers = await Promise.all(
    [apps.admin, apps.publicApp].map(
      (app) =>
        new Promise((resolve) => {
          const server = app.listen(0, '127.0.0.1', () => resolve(server));
        }),
    ),
  );
  const urls = servers.map((s) => `http://127.0.0.1:${s.address().port}`);
  const clients = [];
  t.after(async () => {
    for (const c of clients) await c.close();
    await Promise.all(
      servers.map(
        (s) =>
          new Promise((resolve) => {
            s.close(resolve);
            s.closeAllConnections();
          }),
      ),
    );
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  async function client(session, token) {
    const c = new Client({ name: 'security-test', version: '1.0.0' });
    clients.push(c);
    await c.connect(
      new StreamableHTTPClientTransport(new URL(`${urls[1]}/mcp/${session.id}`), {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
      }),
    );
    return c;
  }
  return { store, sent, urls, client };
}
test('public listener never exposes management and requires authentication', async (t) => {
  const { urls, store } = await fixture(t);
  const s = store.createSession('Private');
  assert.equal((await fetch(`${urls[1]}/api/sessions`)).status, 404);
  assert.equal((await fetch(`${urls[0]}/api/sessions`)).status, 401);
  assert.equal((await fetch(`${urls[1]}/mcp/${s.id}`, { method: 'POST' })).status, 401);
  assert.equal(
    (
      await fetch(`${urls[0]}/api/sessions`, {
        headers: { Authorization: `Bearer ${'a'.repeat(64)}`, Origin: 'https://evil.example' },
      })
    ).status,
    403,
  );
});
test('tokens are hashed, session-scoped, expiring and immediately revocable', async (t) => {
  const { store, urls } = await fixture(t);
  const a = store.createSession('A'),
    b = store.createSession('B');
  const token = store.issueToken(a.id, 'Reader', 'read');
  assert.equal(store.tokens(a.id)[0].token, undefined);
  assert.notEqual(store.db.prepare('SELECT hash FROM tokens').get().hash, token.token);
  assert.equal(store.authenticate(b.id, token.token), null);
  assert.equal(
    (
      await fetch(`${urls[1]}/mcp/${b.id}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token.token}` },
      })
    ).status,
    401,
  );
  store.db.prepare('UPDATE tokens SET expires=? WHERE id=?').run('2000-01-01T00:00:00.000Z', token.id);
  assert.equal(store.authenticate(a.id, token.token), null);
  const fresh = store.issueToken(a.id, 'New', 'read');
  store.revoke(a.id, fresh.id);
  assert.equal(store.authenticate(a.id, fresh.token), null);
});
test('MCP SDK client can initialize, list tools and only read its own session', async (t) => {
  const { store, client, sent } = await fixture(t);
  const a = store.createSession('A'),
    b = store.createSession('B');
  store.message(a.id, {
    key: { id: 'a', remoteJid: '5511999999999@s.whatsapp.net' },
    message: { conversation: 'visible' },
    messageTimestamp: 100,
  });
  store.message(b.id, {
    key: { id: 'b', remoteJid: '5511999999999@s.whatsapp.net' },
    message: { conversation: 'secret' },
    messageTimestamp: 100,
  });
  const token = store.issueToken(a.id, 'Reader', 'read'),
    c = await client(a, token.token);
  assert.deepEqual((await c.listTools()).tools.map((t) => t.name).sort(), [
    'get_messages',
    'list_chats',
    'search_messages',
    'session_status',
  ]);
  const result = await c.callTool({ name: 'search_messages', arguments: { query: 'visible' } });
  assert.equal(JSON.parse(result.content[0].text)[0].body, 'visible');
  const hidden = await c.callTool({ name: 'search_messages', arguments: { query: 'secret' } });
  assert.deepEqual(JSON.parse(hidden.content[0].text), []);
  const denied = await c.callTool({
    name: 'send_message',
    arguments: { jid: '5511999999999@s.whatsapp.net', text: 'no' },
  });
  assert.equal(denied.isError, true);
  assert.equal(sent.length, 0);
  store.revoke(a.id, token.id);
  await assert.rejects(() => c.listTools());
});
test('send permission exposes sending and audit, rejects invalid recipient', async (t) => {
  const { store, client, sent } = await fixture(t);
  const s = store.createSession('Sender');
  const token = store.issueToken(s.id, 'Writer', 'read_write'),
    c = await client(s, token.token);
  assert.ok((await c.listTools()).tools.some((t) => t.name === 'send_message'));
  const invalid = await c.callTool({
    name: 'send_message',
    arguments: { jid: '../../session', text: 'bad' },
  });
  assert.equal(invalid.isError, true);
  assert.equal(sent.length, 0);
  const result = await c.callTool({
    name: 'send_message',
    arguments: { jid: '5511999999999@s.whatsapp.net', text: 'Authorized test' },
  });
  assert.equal(result.isError, undefined);
  assert.equal(sent.length, 1);
  assert.equal(store.events(s.id)[0].action, 'send_message');
});
test('history survives restarts and duplicate WhatsApp events stay idempotent', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'wamcp-persistence-'));
  let store = openStore(dir);
  try {
    const s = store.createSession('Persistent');
    const m = {
      key: { id: 'message-1', remoteJid: '5511999999999@s.whatsapp.net' },
      message: { conversation: 'Saved' },
      messageTimestamp: 10,
    };
    store.message(s.id, m);
    store.message(s.id, m);
    store.close();
    store = openStore(dir);
    assert.equal(store.sessions().length, 1);
    assert.equal(store.messages(s.id, m.key.remoteJid).length, 1);
    assert.equal(store.messages(s.id, m.key.remoteJid)[0].body, 'Saved');
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
