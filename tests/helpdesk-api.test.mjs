import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { helpdeskFixture, PASSWORD } from './helpdesk-fixture.mjs';

async function withAgent(f, admin, { inbox = true, email = 'maria@example.com', role = 'agent' } = {}) {
  const inboxes = (await admin.get('/inboxes')).body;
  const created = await admin.post('/agents', {
    name: email.split('@')[0],
    email,
    role,
    password: PASSWORD,
    inbox_ids: inbox ? [inboxes[0].id] : [],
  });
  assert.equal(created.status, 201);
  return f.login(email);
}

test('bootstrap creates the first administrator only once and login issues a secure cookie', async (t) => {
  const f = await helpdeskFixture(t);
  assert.deepEqual(await (await f.admin('/api/helpdesk/status')).json(), { needsBootstrap: true });
  const admin = await f.bootstrap();
  assert.equal(admin.user.role, 'administrator');
  const again = await f.admin('/api/helpdesk/bootstrap', {
    method: 'POST',
    body: JSON.stringify({ name: 'X', email: 'x@example.com', password: PASSWORD }),
  });
  assert.equal(again.status, 409);
  const res = await fetch(f.publicUrl + '/api/v1/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'ADMIN@example.com', password: PASSWORD }),
  });
  assert.match(res.headers.get('set-cookie'), /HttpOnly; Secure; SameSite=Strict/);
  assert.equal((await f.login('admin@example.com', 'senha-errada-000')).status, 401);
  assert.equal((await f.login('ninguem@example.com')).status, 401);
});

test('API rejects missing sessions, missing CSRF tokens and foreign origins', async (t) => {
  const f = await helpdeskFixture(t);
  const admin = await f.bootstrap();
  assert.equal((await fetch(f.publicUrl + '/api/v1/conversations')).status, 401);
  const noCsrf = await fetch(f.publicUrl + '/api/v1/teams', {
    method: 'POST',
    headers: { cookie: admin.cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Vendas' }),
  });
  assert.equal(noCsrf.status, 403);
  const foreign = await fetch(f.publicUrl + '/api/v1/auth/me', {
    headers: { cookie: admin.cookie, origin: 'https://evil.example' },
  });
  assert.equal(foreign.status, 403);
  const token = (await admin.post('/profile/access_token')).body.token;
  const viaToken = await fetch(f.publicUrl + '/api/v1/auth/me', { headers: { api_access_token: token } });
  assert.equal((await viaToken.json()).user.email, 'admin@example.com');
  await admin.post('/auth/logout');
  assert.equal((await admin.get('/auth/me')).status, 401);
});

test('existing WhatsApp sessions become inboxes and live messages open conversations', async (t) => {
  const f = await helpdeskFixture(t);
  const session = f.store.createSession('Suporte');
  const admin = await f.bootstrap();
  const [inbox] = (await admin.get('/inboxes')).body;
  assert.equal(inbox.name, 'Suporte');
  assert.equal(inbox.session_id, session.id);

  f.incoming(session.id, { id: 'IN1', body: 'Preciso de ajuda', name: 'João' });
  f.incoming(session.id, { id: 'IN1', body: 'Preciso de ajuda' }); // duplicate delivery
  f.incoming(session.id, { id: 'IN2', body: 'Alô?' });
  f.incoming(session.id, { id: 'G1', jid: '120363@g.us', body: 'grupo' });

  const list = (await admin.get('/conversations')).body;
  assert.equal(list.length, 1);
  assert.equal(list[0].display_id, 1);
  assert.equal(list[0].contact_name, 'João');
  assert.equal(list[0].contact_phone, '+5511988887777');
  assert.equal(list[0].unread_count, 2);
  const messages = (await admin.get('/conversations/1/messages')).body;
  assert.deepEqual(
    messages.map((m) => [m.message_type, m.content, m.sender_name]),
    [
      ['incoming', 'Preciso de ajuda', 'João'],
      ['incoming', 'Alô?', 'João'],
    ],
  );
  assert.ok(f.events.some((e) => e.event === 'conversation.created'));
  await admin.post('/conversations/1/update_last_seen');
  assert.equal((await admin.get('/conversations/1')).body.unread_count, 0);
});

test('agents see only conversations from inboxes they belong to', async (t) => {
  const f = await helpdeskFixture(t);
  const a = f.store.createSession('A'),
    b = f.store.createSession('B');
  const admin = await f.bootstrap();
  const maria = await withAgent(f, admin);
  f.incoming(a.id, { id: 'A1' });
  f.incoming(b.id, { id: 'B1', jid: '5511900000000@s.whatsapp.net' });
  const mine = (await maria.get('/conversations')).body;
  assert.equal(mine.length, 1);
  assert.equal(mine[0].inbox_name, 'A');
  const other = (await admin.get('/conversations?q=900000')).body[0];
  assert.equal((await maria.get(`/conversations/${other.display_id}`)).status, 404);
  assert.equal(
    (await maria.post('/agents', { name: 'x', email: 'x@x.com', password: PASSWORD })).status,
    403,
  );
  assert.equal((await maria.get('/inboxes')).body.length, 1);
});

test('replies go to WhatsApp, private notes do not, and failures are recorded', async (t) => {
  const f = await helpdeskFixture(t);
  const s = f.store.createSession('Suporte');
  const admin = await f.bootstrap();
  const maria = await withAgent(f, admin);
  f.incoming(s.id, { id: 'IN1' });

  const reply = await maria.post('/conversations/1/messages', { content: 'Oi, como posso ajudar?' });
  assert.equal(reply.status, 201);
  assert.equal(reply.body.status, 'sent');
  assert.deepEqual(f.sent, [
    {
      sessionId: s.id,
      jid: '5511988887777@s.whatsapp.net',
      text: 'Oi, como posso ajudar?',
      messageId: 'OUT1',
    },
  ]);
  // Baileys echoes our own message back; it must not be duplicated.
  f.incoming(s.id, { id: 'OUT1', body: 'Oi, como posso ajudar?', fromMe: true });

  const note = await maria.post('/conversations/1/messages', { content: 'cliente VIP', private: true });
  assert.equal(note.body.private, 1);
  assert.equal(f.sent.length, 1);

  f.wa.fail = true;
  const failed = await maria.post('/conversations/1/messages', { content: 'teste' });
  assert.equal(failed.body.status, 'failed');
  assert.match(failed.body.content_attributes, /Sessão desconectada/);

  const conversation = (await maria.get('/conversations/1')).body;
  assert.equal(conversation.assignee_id, maria.user.id, 'replying agent takes the unassigned conversation');
  assert.ok(conversation.first_reply_at);
  const messages = (await maria.get('/conversations/1/messages')).body;
  assert.equal(messages.filter((m) => m.message_type === 'outgoing').length, 3);

  f.helpdesk.receipt(s.id, 'OUT1', 'read');
  f.helpdesk.receipt(s.id, 'OUT1', 'delivered'); // late, lower-ranked receipt is ignored
  const sent = (await maria.get('/conversations/1/messages')).body.find((m) => m.source_id === 'OUT1');
  assert.equal(sent.status, 'read');
});

test('status changes write activities and resolved conversations reopen on new messages', async (t) => {
  const f = await helpdeskFixture(t);
  const s = f.store.createSession('Suporte');
  const admin = await f.bootstrap();
  f.incoming(s.id, { id: 'IN1' });
  const resolved = await admin.post('/conversations/1/toggle_status', { status: 'resolved' });
  assert.equal(resolved.body.status, 'resolved');
  f.incoming(s.id, { id: 'IN2', body: 'voltei' });
  assert.equal((await admin.get('/conversations/1')).body.status, 'open');

  await admin.patch(`/inboxes/${resolved.body.inbox_id}`, { lock_to_single_conversation: false });
  await admin.post('/conversations/1/toggle_status', { status: 'resolved' });
  f.incoming(s.id, { id: 'IN3', body: 'outra dúvida' });
  assert.equal((await admin.get('/conversations?status=all')).body.length, 2);

  await admin.post('/conversations/2/toggle_status', { status: 'snoozed', snoozed_until: f.now() + 3600 });
  f.tick(3601);
  f.helpdesk.wakeSnoozed();
  assert.equal((await admin.get('/conversations/2')).body.status, 'open');

  const activities = (await admin.get('/conversations/1/messages')).body.filter(
    (m) => m.message_type === 'activity',
  );
  assert.deepEqual(
    activities.map((m) => m.content),
    ['Admin resolveu a conversa', 'Admin resolveu a conversa'],
  );
});

test('assignment validates inbox membership and round robin spreads conversations among online agents', async (t) => {
  const f = await helpdeskFixture(t);
  const s = f.store.createSession('Suporte');
  const admin = await f.bootstrap();
  await admin.patch('/profile', { availability: 'busy' });
  const maria = await withAgent(f, admin, { email: 'maria@example.com' });
  const ana = await withAgent(f, admin, { email: 'ana@example.com' });
  const outsider = await withAgent(f, admin, { email: 'fora@example.com', inbox: false });
  await maria.patch('/profile', { availability: 'online' });
  await ana.patch('/profile', { availability: 'online' });

  for (const [n, jid] of ['5511900000001', '5511900000002', '5511900000003'].entries())
    f.incoming(s.id, { id: `IN${n}`, jid: `${jid}@s.whatsapp.net` });
  const assignees = (await admin.get('/conversations?status=all')).body.map((c) => c.assignee_id).sort();
  assert.deepEqual(assignees, [maria.user.id, maria.user.id, ana.user.id].sort());

  const denied = await admin.post('/conversations/1/assignments', { assignee_id: outsider.user.id });
  assert.equal(denied.status, 422);
  const team = (await admin.post('/teams', { name: 'Financeiro' })).body;
  await admin.post(`/teams/${team.id}/members`, { user_ids: [ana.user.id] });
  const assigned = await admin.post('/conversations/1/assignments', { assignee_id: null, team_id: team.id });
  assert.equal(assigned.body.team_name, 'Financeiro');
  assert.equal(assigned.body.assignee_id, null);
  const meta = (await maria.get('/conversations/meta?status=all')).body;
  assert.deepEqual(Object.keys(meta).sort(), ['all', 'mine', 'unassigned']);
});

test('the last active administrator cannot be removed or demoted', async (t) => {
  const f = await helpdeskFixture(t);
  const admin = await f.bootstrap();
  assert.equal((await admin.patch(`/agents/${admin.user.id}`, { role: 'agent' })).status, 409);
  assert.equal((await admin.del(`/agents/${admin.user.id}`)).status, 409);
  const maria = await withAgent(f, admin, { inbox: false });
  assert.equal((await admin.patch(`/agents/${maria.user.id}`, { active: false })).status, 200);
  assert.equal((await maria.get('/auth/me')).status, 401, 'deactivation ends active sessions');
});

test('migration turns sessions created by older versions into inboxes', async (t) => {
  const f = await helpdeskFixture(t, {
    beforeStart(dir) {
      const db = new DatabaseSync(path.join(dir, 'wamcp.sqlite'));
      db.exec(`CREATE TABLE sessions(id TEXT PRIMARY KEY,name TEXT NOT NULL,phone TEXT,status TEXT NOT NULL DEFAULT 'disconnected',created TEXT NOT NULL);
        INSERT INTO sessions VALUES('legacy','Antiga',NULL,'disconnected','2026-01-01T00:00:00Z');`);
      db.close();
    },
  });
  const row = f.store.db
    .prepare('SELECT i.name FROM inboxes i JOIN channel_whatsapp w ON w.id=i.channel_id WHERE w.session_id=?')
    .get('legacy');
  assert.equal(row.name, 'Antiga');
  assert.equal(f.store.db.prepare('PRAGMA user_version').get().user_version, 5);
});
