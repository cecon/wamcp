import { test } from 'node:test';
import assert from 'node:assert/strict';
import { helpdeskFixture, PASSWORD } from './helpdesk-fixture.mjs';

async function setup(t) {
  const f = await helpdeskFixture(t);
  const session = f.store.createSession('Suporte');
  const admin = await f.bootstrap();
  const [inbox] = (await admin.get('/inboxes')).body;
  return { f, session, admin, inbox };
}

test('webhooks queue signed deliveries, filter by inbox and retry with backoff', async (t) => {
  const { f, session, admin } = await setup(t);
  await admin.post('/agents', {
    name: 'Maria',
    email: 'maria@example.com',
    password: PASSWORD,
    inbox_ids: [],
  });
  const maria = await f.login('maria@example.com');
  assert.equal((await maria.get('/webhooks')).status, 403);
  assert.equal(
    (await admin.post('/webhooks', { url: 'ftp://x', subscriptions: ['message_created'] })).status,
    400,
  );
  const hook = (
    await admin.post('/webhooks', {
      url: 'https://crm.example/hook',
      subscriptions: ['message_created', 'conversation_created'],
    })
  ).body;
  assert.equal(hook.secret, 'test-secret');
  const missingInbox = {
    url: 'https://other.example/hook',
    subscriptions: ['message_created'],
    inbox_id: 999,
  };
  assert.equal((await admin.post('/webhooks', missingInbox)).status, 422);
  const sessionB = f.store.createSession('Vendas');
  const inboxB = (await admin.get('/inboxes')).body.find((i) => i.session_id === sessionB.id);
  const other = await admin.post('/webhooks', { ...missingInbox, inbox_id: inboxB.id });
  assert.equal(other.status, 201);

  f.incoming(session.id, { id: 'IN1', body: 'Olá' });
  await f.support.webhooks.deliverDue();
  assert.deepEqual(
    f.posts.map((p) => [p.url, p.body.event]),
    [
      ['https://crm.example/hook', 'conversation_created'],
      ['https://crm.example/hook', 'message_created'],
    ],
  );
  assert.equal(f.posts[1].body.data.content, 'Olá');
  assert.equal(f.posts[1].secret, 'test-secret');

  f.sender.respond = () => ({ ok: false, status: 503 });
  f.incoming(session.id, { id: 'IN2', body: 'Alô' });
  await f.support.webhooks.deliverDue();
  let deliveries = (await admin.get(`/webhooks/${hook.id}/deliveries`)).body;
  assert.deepEqual(
    [deliveries[0].status, deliveries[0].attempts, deliveries[0].last_error],
    ['pending', 1, 'HTTP 503'],
  );
  await f.support.webhooks.deliverDue();
  assert.equal(
    (await admin.get(`/webhooks/${hook.id}/deliveries`)).body[0].attempts,
    1,
    'waits for the backoff',
  );
  f.sender.respond = () => {
    throw new Error('ECONNREFUSED');
  };
  for (const delay of [30, 120, 600, 3600]) {
    f.tick(delay);
    await f.support.webhooks.deliverDue();
  }
  deliveries = (await admin.get(`/webhooks/${hook.id}/deliveries`)).body;
  assert.deepEqual(
    [deliveries[0].status, deliveries[0].attempts, deliveries[0].last_error],
    ['failed', 5, 'Falha de conexão'],
  );

  assert.equal((await admin.patch(`/webhooks/${hook.id}`, { active: false })).body.active, 0);
  assert.equal((await admin.patch(`/webhooks/${hook.id}`, { url: 'bad' })).status, 400);
  assert.equal((await admin.del(`/webhooks/${hook.id}`)).status, 200);
  assert.equal((await admin.get(`/webhooks/${hook.id}/deliveries`)).status, 404);
});

test('automation rules run actions once without retriggering themselves', async (t) => {
  const { f, session, admin } = await setup(t);
  await admin.post('/labels', { title: 'financeiro' });
  const team = (await admin.post('/teams', { name: 'Cobrança' })).body;
  const invalid = await admin.post('/automation_rules', {
    name: 'x',
    event_name: 'message_created',
    conditions: [],
    actions: [{ action_name: 'add_label' }],
  });
  assert.equal(invalid.status, 400);
  const rule = await admin.post('/automation_rules', {
    name: 'Boletos',
    event_name: 'message_created',
    conditions: [
      { attribute_key: 'message_type', filter_operator: 'equal_to', values: ['incoming'] },
      { attribute_key: 'content', filter_operator: 'contains', values: ['boleto'] },
    ],
    actions: [
      { action_name: 'add_label', action_params: ['financeiro'] },
      { action_name: 'assign_team', action_params: [team.id] },
      { action_name: 'set_priority', action_params: ['high'] },
      { action_name: 'send_message', action_params: ['Já encaminhei para o financeiro.'] },
      { action_name: 'add_private_note', action_params: ['Cliente pediu boleto (automação)'] },
      { action_name: 'assign_agent', action_params: [999] },
    ],
  });
  assert.equal(rule.status, 201);
  f.incoming(session.id, { id: 'IN1', body: 'Preciso do BOLETO de outubro' });
  await f.settle();
  const conversation = (await admin.get('/conversations/1')).body;
  assert.deepEqual(
    [conversation.labels, conversation.team_name, conversation.priority],
    [['financeiro'], 'Cobrança', 'high'],
  );
  assert.deepEqual(
    f.sent.map((s) => s.text),
    ['Já encaminhei para o financeiro.'],
    'sent once, no loop',
  );
  const messages = (await admin.get('/conversations/1/messages')).body;
  const automated = messages.find((m) => m.content === 'Já encaminhei para o financeiro.');
  assert.equal(automated.content_attributes.automated, 'Automação “Boletos”');
  assert.ok(messages.some((m) => m.private && m.content.includes('automação')));
  assert.ok(
    messages.some(
      (m) => m.message_type === 'activity' && m.content.startsWith('Automação “Boletos” adicionou'),
    ),
  );

  await admin.patch(`/automation_rules/${rule.body.id}`, { active: false });
  f.incoming(session.id, { id: 'IN2', jid: '5511900000000@s.whatsapp.net', body: 'boleto' });
  await f.settle();
  assert.equal(f.sent.length, 1);
  assert.equal((await admin.get('/automation_rules')).body[0].active, 0);
  assert.equal((await admin.patch(`/automation_rules/${rule.body.id}`, { event_name: 'nope' })).status, 400);
  assert.equal((await admin.del(`/automation_rules/${rule.body.id}`)).status, 200);
  assert.equal((await admin.del(`/automation_rules/${rule.body.id}`)).status, 404);
});

test('rules on resolution and reopening can resolve or reopen conversations', async (t) => {
  const { f, session, admin } = await setup(t);
  await admin.post('/automation_rules', {
    name: 'Reabrir VIP',
    event_name: 'conversation_resolved',
    conditions: [{ attribute_key: 'contact_name', filter_operator: 'equal_to', values: ['vip'] }],
    actions: [{ action_name: 'open_conversation' }],
  });
  await admin.post('/automation_rules', {
    name: 'Fechar spam',
    event_name: 'conversation_created',
    conditions: [{ attribute_key: 'contact_name', filter_operator: 'contains', values: ['spam'] }],
    actions: [{ action_name: 'resolve_conversation' }],
  });
  f.incoming(session.id, { id: 'IN1', name: 'VIP' });
  f.incoming(session.id, { id: 'IN2', jid: '5511900000000@s.whatsapp.net', name: 'Spammer' });
  await f.settle();
  await admin.post('/conversations/1/toggle_status', { status: 'resolved' });
  await f.settle();
  assert.equal((await admin.get('/conversations/1')).body.status, 'open');
  assert.equal((await admin.get('/conversations/2')).body.status, 'resolved');
});

test('greeting and out-of-office messages follow working hours', async (t) => {
  const { f, session, admin, inbox } = await setup(t);
  const closed = [0, 1, 2, 3, 4, 5, 6].map((d) => ({
    day_of_week: d,
    closed_all_day: true,
    open_minutes: 0,
    close_minutes: 0,
  }));
  assert.equal(
    (await admin.put(`/inboxes/${inbox.id}/working_hours`, { working_hours: [closed[0], closed[0]] })).status,
    400,
  );
  assert.equal((await admin.patch(`/inboxes/${inbox.id}`, { timezone: 'Mars/Olympus' })).status, 400);
  await admin.put(`/inboxes/${inbox.id}/working_hours`, { working_hours: closed });
  await admin.patch(`/inboxes/${inbox.id}`, {
    greeting_enabled: true,
    greeting_message: 'Olá! Recebemos sua mensagem.',
    working_hours_enabled: true,
    out_of_office_message: 'Estamos fora do horário.',
  });
  f.incoming(session.id, { id: 'IN1' });
  await f.settle();
  assert.deepEqual(
    f.sent.map((s) => s.text),
    ['Olá! Recebemos sua mensagem.', 'Estamos fora do horário.'],
  );
  const messages = (await admin.get('/conversations/1/messages')).body;
  assert.equal(messages.at(-1).content_attributes.automated, 'Fora do horário');
  assert.equal(
    (await admin.get('/conversations/1')).body.first_reply_at,
    null,
    'automatic messages are not replies',
  );

  const open = closed.map((d) => ({ ...d, closed_all_day: false, open_minutes: 0, close_minutes: 1440 }));
  assert.equal(
    (await admin.put(`/inboxes/${inbox.id}/working_hours`, { working_hours: open })).body.length,
    7,
  );
  assert.equal((await admin.get(`/inboxes/${inbox.id}/working_hours`)).body[0].close_minutes, 1440);
  f.incoming(session.id, { id: 'IN2', jid: '5511900000000@s.whatsapp.net' });
  await f.settle();
  assert.equal(f.sent.at(-1).text, 'Olá! Recebemos sua mensagem.', 'no out-of-office during open hours');
});

test('CSAT survey is sent on resolution and the rating is recorded without reopening', async (t) => {
  const { f, session, admin, inbox } = await setup(t);
  await admin.patch(`/inboxes/${inbox.id}`, { csat_survey_enabled: true });
  f.incoming(session.id, { id: 'IN1' });
  await admin.post('/conversations/1/assignments', { assignee_id: admin.user.id });
  await admin.post('/conversations/1/toggle_status', { status: 'resolved' });
  await f.settle();
  assert.match(f.sent.at(-1).text, /nota de 1/);
  f.incoming(session.id, { id: 'IN2', body: '5 - ótimo atendimento' });
  await f.settle();
  assert.equal((await admin.get('/conversations/1')).body.status, 'resolved');
  assert.equal(f.sent.at(-1).text, 'Obrigado pela avaliação!');
  const [csat] = (await admin.get('/csat_responses')).body;
  assert.deepEqual([csat.rating, csat.feedback, csat.assignee_name], [5, 'ótimo atendimento', 'Admin']);
  f.incoming(session.id, { id: 'IN3', body: 'outra coisa' });
  assert.equal((await admin.get('/conversations/1')).body.status, 'open', 'non-ratings reopen as usual');
});

test('reports aggregate first response, resolution, volume and CSAT per agent', async (t) => {
  const { f, session, admin } = await setup(t);
  await admin.post('/agents', {
    name: 'Maria',
    email: 'maria@example.com',
    password: PASSWORD,
    inbox_ids: [1],
  });
  const maria = await f.login('maria@example.com');
  const since = f.now() - 10;
  f.incoming(session.id, { id: 'IN1' });
  f.tick(120);
  await maria.post('/conversations/1/messages', { content: 'Oi!' });
  f.tick(60);
  await maria.post('/conversations/1/messages', { content: 'Algo mais?' });
  f.tick(300);
  await maria.post('/conversations/1/toggle_status', { status: 'resolved' });
  await f.settle();
  assert.equal((await maria.get('/reports/summary')).status, 403);
  const summary = (await admin.get(`/reports/summary?since=${since}&until=${f.now() + 1}`)).body;
  assert.deepEqual(summary.first_response, { count: 1, average: 120 });
  assert.deepEqual(summary.resolutions, { count: 1, average: 480 });
  assert.equal(summary.incoming_messages, 1);
  assert.equal(summary.outgoing_messages, 2);
  const agents = (await admin.get(`/reports/agents?since=${since}&until=${f.now() + 1}&inbox_id=1`)).body;
  const row = agents.find((a) => a.name === 'Maria');
  assert.deepEqual([row.resolved, row.avg_first_response, row.avg_resolution], [1, 120, 480]);
  assert.equal((await admin.get('/reports/summary?since=1&until=2')).body.first_response.count, 0);

  const priority = await maria.post('/conversations/1/toggle_priority', { priority: 'urgent' });
  assert.equal(priority.body.priority, 'urgent');
  assert.equal(
    (await maria.post('/conversations/1/toggle_priority', { priority: 'urgent' })).body.priority,
    'urgent',
  );
});
