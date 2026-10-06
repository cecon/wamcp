import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { createHmac } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openStore } from '../server/adapters/outbound/sqlite/store.mjs';
import { eventStore } from '../server/adapters/outbound/sqlite/event-store.mjs';
import { eventService } from '../server/application/events.mjs';
import { eventWebhook } from '../server/adapters/outbound/event-webhook.mjs';
import { persistLiveMessages } from '../server/adapters/outbound/whatsapp-events.mjs';
import { mcpService } from '../server/application/mcp.mjs';
import { sessionService } from '../server/application/sessions.mjs';
import { createApps } from '../server/adapters/inbound/http.mjs';
import { envelope, version, jid, subscription } from './mcp-events-protocol-fixture.mjs';

async function listen(server) {
  server.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.on('listening', resolve));
  return server.address().port;
}
async function close(server) {
  await new Promise((resolve) => {
    server.close(resolve);
    server.closeAllConnections();
  });
}
test('HTTP subscribe → signed callback → incoming delivery → authorized reply → unsubscribe', async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'wamcp-events-full-'));
  const store = openStore(dir),
    repository = eventStore(store.db);
  const a = store.createSession('A'),
    b = store.createSession('B');
  const token = store.issueToken(a.id, 'Writer', 'read_write');
  const received = [],
    signatureErrors = [];
  let subscribedId;
  const receiver = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    try {
      const expected = createHmac('sha256', Buffer.from(subscription.delivery.secret.slice(6), 'base64'))
        .update(`${req.headers['webhook-id']}.${req.headers['webhook-timestamp']}.${raw}`)
        .digest('base64');
      assert.equal(req.headers['webhook-signature'], `v1,${expected}`);
      const event = JSON.parse(raw);
      assert.match(req.headers['x-mcp-subscription-id'], /^sub_/);
      if (event.type === 'verification') {
        received.push({ verification: event.challenge });
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ challenge: event.challenge }));
      } else {
        assert.equal(req.headers['webhook-id'], event.eventId);
        assert.equal(req.headers['x-mcp-subscription-id'], subscribedId);
        received.push(event);
        res.writeHead(204).end();
      }
    } catch (error) {
      signatureErrors.push(error);
      res.writeHead(400).end();
    }
  });
  const receiverPort = await listen(receiver);
  // Test-only network port routes a validated public destination to the controlled local receiver.
  // Production uses HTTPS/TLS; separate adapter tests cover address pinning and TLS validation.
  const webhook = eventWebhook({
    resolve: async () => [{ address: '8.8.8.8', family: 4 }],
    request: (options, callback) =>
      request(
        {
          hostname: '127.0.0.1',
          port: receiverPort,
          path: options.path,
          method: options.method,
          headers: options.headers,
          agent: false,
        },
        callback,
      ),
  });
  const events = eventService(repository, webhook, {
    authorize: (sessionId, principalId, kind) =>
      kind === 'token' && Boolean(store.eventPrincipal(sessionId, principalId)),
  });
  const sent = [];
  const wa = {
    async send(sessionId, target, text) {
      sent.push({ sessionId, target, text });
      persistLiveMessages(
        store,
        sessionId,
        {
          type: 'notify',
          messages: [
            {
              key: { id: 'outbound-reply', remoteJid: target, fromMe: true },
              message: { conversation: text },
              messageTimestamp: 1000,
            },
          ],
        },
        events.publish,
      );
      return { id: 'outbound-reply' };
    },
  };
  const apps = createApps({
    sessions: sessionService(store, wa, events),
    mcp: mcpService(store, wa),
    events,
    adminToken: 'a'.repeat(64),
  });
  const publicServer = createServer(apps.publicApp);
  const port = await listen(publicServer);
  t.after(async () => {
    await events.close();
    await close(publicServer);
    await close(receiver);
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  async function rpc(method, params = {}) {
    const response = await fetch(`http://127.0.0.1:${port}/mcp/${a.id}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token.token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'MCP-Protocol-Version': version,
        'MCP-Method': method,
        ...(params.name ? { 'MCP-Name': params.name } : {}),
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: { _meta: envelope(), ...params } }),
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.error, undefined, JSON.stringify(body.error));
    return body.result;
  }
  assert.deepEqual((await rpc('server/discover')).capabilities.events, {});
  assert.equal((await rpc('events/list')).events[0].name, 'message.created');
  subscribedId = (await rpc('events/subscribe', subscription)).id;
  assert.equal(received.length, 1);
  assert.equal((await rpc('events/subscribe', subscription)).id, subscribedId);
  assert.equal(received.length, 1, 'idempotent refresh uses bounded verification cache');
  const incoming = (id, target = jid) => ({
    key: { id, remoteJid: target, fromMe: false },
    message: { conversation: 'Hello from the controlled upstream' },
    messageTimestamp: 1000,
  });
  const ingest = (sessionId, messages) =>
    persistLiveMessages(store, sessionId, { type: 'notify', messages }, events.publish);
  ingest(b.id, [incoming('other-session')]);
  ingest(a.id, [incoming('other-chat', '5511888888888@s.whatsapp.net')]);
  ingest(a.id, [incoming('received-1'), incoming('received-1')]);
  await events.flush();
  assert.equal(received.length, 2);
  assert.equal(received[1].data.message_id, 'received-1');
  assert.equal(received[1].data.from_me, false);
  assert.equal(received[1].cursor, null);
  const reply = await rpc('tools/call', {
    name: 'send_message',
    arguments: { jid, text: 'Authorized test reply' },
  });
  assert.equal(reply.isError, undefined);
  assert.deepEqual(sent, [{ sessionId: a.id, target: jid, text: 'Authorized test reply' }]);
  await events.flush();
  assert.equal(received.length, 2, 'outbound reply cannot create a response loop');
  const delivery = { mode: subscription.delivery.mode, url: subscription.delivery.url };
  await rpc('events/unsubscribe', { name: subscription.name, arguments: subscription.arguments, delivery });
  ingest(a.id, [incoming('after-unsubscribe')]);
  await events.flush();
  assert.equal(received.length, 2);
  assert.equal(repository.list().length, 0);
  assert.deepEqual(signatureErrors, []);
});
