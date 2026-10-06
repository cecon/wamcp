import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { helpdeskFixture, PASSWORD } from './helpdesk-fixture.mjs';

async function agent(f, admin, email, inboxIds) {
  await admin.post('/agents', { name: email.split('@')[0], email, password: PASSWORD, inbox_ids: inboxIds });
  return f.login(email);
}

test('labels are admin-managed, replace the conversation set and filter the list', async (t) => {
  const f = await helpdeskFixture(t);
  const s = f.store.createSession('Suporte');
  const admin = await f.bootstrap();
  const [inbox] = (await admin.get('/inboxes')).body;
  const maria = await agent(f, admin, 'maria@example.com', [inbox.id]);
  assert.equal((await maria.post('/labels', { title: 'vip' })).status, 403);
  assert.equal(
    (await admin.post('/labels', { title: 'Cliente VIP', color: '#ff0000' })).body.title,
    'cliente-vip',
  );
  await admin.post('/labels', { title: 'financeiro' });
  assert.equal((await admin.post('/labels', { title: 'FINANCEIRO' })).status, 409);

  f.incoming(s.id, { id: 'IN1' });
  f.incoming(s.id, { id: 'IN2', jid: '5511900000000@s.whatsapp.net' });
  const set = await maria.post('/conversations/1/labels', { labels: ['cliente-vip', 'financeiro'] });
  assert.deepEqual(set.body.labels, ['cliente-vip', 'financeiro']);
  assert.equal((await maria.post('/conversations/1/labels', { labels: ['nao-existe'] })).status, 422);
  await maria.post('/conversations/1/labels', { labels: ['financeiro'] });
  const filtered = (await maria.get('/conversations?label=financeiro')).body;
  assert.deepEqual(
    filtered.map((c) => c.display_id),
    [1],
  );
  const activities = (await maria.get('/conversations/1/messages')).body.filter(
    (m) => m.message_type === 'activity',
  );
  assert.deepEqual(
    activities.map((m) => m.content),
    ['maria adicionou cliente-vip, financeiro', 'maria removeu cliente-vip'],
  );
});

test('any agent creates canned responses; only admins delete them', async (t) => {
  const f = await helpdeskFixture(t);
  const admin = await f.bootstrap();
  const maria = await agent(f, admin, 'maria@example.com', []);
  const created = await maria.post('/canned_responses', {
    short_code: 'Saudacao',
    content: 'Olá! Como posso ajudar?',
  });
  assert.equal(created.body.short_code, 'saudacao');
  assert.equal((await maria.post('/canned_responses', { short_code: 'saudacao', content: 'x' })).status, 409);
  assert.equal((await maria.get('/canned_responses?q=ajudar')).body.length, 1);
  assert.equal((await maria.del(`/canned_responses/${created.body.id}`)).status, 403);
  assert.equal((await admin.del(`/canned_responses/${created.body.id}`)).status, 200);
});

test('notifications follow assignment and new messages on assigned conversations', async (t) => {
  const f = await helpdeskFixture(t);
  const s = f.store.createSession('Suporte');
  const admin = await f.bootstrap();
  const [inbox] = (await admin.get('/inboxes')).body;
  const maria = await agent(f, admin, 'maria@example.com', [inbox.id]);
  f.incoming(s.id, { id: 'IN1' });
  let list = (await maria.get('/notifications')).body;
  assert.deepEqual(
    list.items.map((n) => n.notification_type),
    ['conversation_creation'],
  );
  await admin.post('/conversations/1/assignments', { assignee_id: maria.user.id });
  f.incoming(s.id, { id: 'IN2', body: 'ainda aí?' });
  list = (await maria.get('/notifications')).body;
  assert.deepEqual(
    list.items.map((n) => [n.notification_type, n.display_id]),
    [
      ['assigned_conversation_new_message', 1],
      ['conversation_assignment', 1],
      ['conversation_creation', 1],
    ],
  );
  assert.equal(list.items[1].actor_name, 'Admin');
  assert.equal(list.unread, 3);
  assert.deepEqual((await maria.patch(`/notifications/${list.items[0].id}`, {})).body, { unread: 2 });
  await maria.post('/notifications/read_all');
  assert.equal((await maria.get('/notifications/unread_count')).body.unread, 0);
  assert.equal(
    (await admin.get('/notifications')).body.items.length,
    0,
    'admins are not paged for new chats',
  );
});

test('the event stream only carries events from the agent inboxes', async (t) => {
  const f = await helpdeskFixture(t);
  const a = f.store.createSession('A'),
    b = f.store.createSession('B');
  const admin = await f.bootstrap();
  const inboxes = (await admin.get('/inboxes')).body;
  const maria = await agent(f, admin, 'maria@example.com', [inboxes.find((i) => i.name === 'A').id]);
  const controller = new AbortController();
  t.after(() => controller.abort());
  const res = await fetch(f.publicUrl + '/api/v1/events', {
    headers: { cookie: maria.cookie },
    signal: controller.signal,
  });
  assert.equal(res.headers.get('content-type'), 'text/event-stream; charset=utf-8');
  const reader = res.body.getReader();
  f.incoming(b.id, { id: 'B1', jid: '5511900000000@s.whatsapp.net', body: 'segredo de B' });
  f.incoming(a.id, { id: 'A1', body: 'mensagem de A' });
  let text = '';
  while (!text.includes('mensagem de A')) text += new TextDecoder().decode((await reader.read()).value);
  assert.match(text, /event: conversation.created/);
  assert.doesNotMatch(text, /segredo de B/);
});

test('MCP bot answers pending conversations and hands off to humans', async (t) => {
  const f = await helpdeskFixture(t);
  const s = f.store.createSession('Suporte');
  const admin = await f.bootstrap();
  const [inbox] = (await admin.get('/inboxes')).body;
  await admin.patch(`/inboxes/${inbox.id}`, { agent_bot_enabled: true });
  const maria = await agent(f, admin, 'maria@example.com', [inbox.id]);
  await maria.patch('/profile', { availability: 'online' });
  await admin.post('/labels', { title: 'triagem' });
  f.incoming(s.id, { id: 'IN1', body: 'Quero saber meu pedido' });
  assert.equal((await admin.get('/conversations/1')).body.status, 'pending');
  assert.equal((await admin.get('/conversations/1')).body.assignee_id, null, 'bots work before humans');

  const connect = async (scope) => {
    const { token } = f.store.issueToken(s.id, 'IA', scope);
    const client = new Client({ name: 'helpdesk-test', version: '1.0.0' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${f.publicUrl}/mcp/${s.id}`), {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
      }),
    );
    t.after(() => client.close());
    return client;
  };
  const bot = await connect('read_write');
  const call = async (client, name, args) => {
    const result = await client.callTool({ name, arguments: args });
    return { ...result, data: result.isError ? null : JSON.parse(result.content[0].text) };
  };
  const pending = await call(bot, 'list_conversations', { status: 'pending' });
  assert.deepEqual(
    pending.data.map((c) => c.display_id),
    [1],
  );
  const detail = await call(bot, 'get_conversation', { display_id: 1 });
  assert.equal(detail.data.messages[0].content, 'Quero saber meu pedido');
  const reply = await call(bot, 'reply_conversation', { display_id: 1, content: 'Vou verificar.' });
  assert.equal(reply.data.sender_name, 'Assistente IA');
  assert.equal(f.sent.at(-1).text, 'Vou verificar.');
  await call(bot, 'set_conversation_labels', { display_id: 1, labels: ['triagem'] });
  const handoff = await call(bot, 'set_conversation_status', { display_id: 1, status: 'open' });
  assert.equal(handoff.data.assignee_id, maria.user.id, 'handoff triggers auto-assignment');
  assert.ok(f.events.some((e) => e.event === 'conversation.bot_handoff' && e.performer.type === 'agent_bot'));

  const reader = await connect('read');
  const denied = await reader.callTool({
    name: 'reply_conversation',
    arguments: { display_id: 1, content: 'x' },
  });
  assert.equal(denied.isError, true);
  assert.equal(f.sent.length, 1);
});

test('the agent web app is served with a strict CSP', async (t) => {
  const webDir = mkdtempSync(path.join(os.tmpdir(), 'wamcp-web-'));
  mkdirSync(path.join(webDir, 'assets'));
  writeFileSync(path.join(webDir, 'agent.html'), '<!doctype html><title>Atendimento</title>');
  writeFileSync(path.join(webDir, 'assets', 'app.js'), 'console.log(1)');
  const f = await helpdeskFixture(t, { webDir });
  const page = await fetch(f.publicUrl + '/app/');
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Atendimento/);
  assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal((await fetch(f.publicUrl + '/app/assets/app.js')).status, 200);
  assert.equal((await fetch(f.publicUrl + '/', { redirect: 'manual' })).headers.get('location'), '/app/');
});

test('the agent web app appears once built, without restarting the service', async (t) => {
  let webDir;
  const f = await helpdeskFixture(t, { webDir: () => webDir });
  const missing = await fetch(f.publicUrl + '/app/');
  assert.equal(missing.status, 503);
  assert.equal((await fetch(f.publicUrl + '/app/assets/app.js')).status, 404);
  webDir = mkdtempSync(path.join(os.tmpdir(), 'wamcp-web-'));
  mkdirSync(path.join(webDir, 'assets'));
  writeFileSync(path.join(webDir, 'agent.html'), '<!doctype html><title>Atendimento</title>');
  writeFileSync(path.join(webDir, 'assets', 'app.js'), 'console.log(1)');
  assert.equal((await fetch(f.publicUrl + '/app/')).status, 200);
  assert.equal((await fetch(f.publicUrl + '/app/assets/app.js')).status, 200);
});
