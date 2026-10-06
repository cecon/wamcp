import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { isOpen, localTime, validateSchedule, validateTimezone } from '../server/domain/schedule.mjs';
import { automationEventsFor, matchesConditions, validateRule } from '../server/domain/automation.mjs';
import { awaitingCsat, parseRating, CSAT_WINDOW_SECONDS } from '../server/domain/csat.mjs';
import { retryDelay, validateWebhook, webhookEventFor, MAX_ATTEMPTS } from '../server/domain/webhooks.mjs';
import { webhookSender } from '../server/adapters/outbound/webhook-sender.mjs';

// 2026-10-05T12:30:00Z is a Monday; in São Paulo (UTC-3) it is 09:30.
const MONDAY_NOON_UTC = Date.UTC(2026, 9, 5, 12, 30) / 1000;

test('working hours follow the inbox timezone', () => {
  assert.deepEqual(localTime(MONDAY_NOON_UTC, 'UTC'), { day: 1, minutes: 750 });
  assert.deepEqual(localTime(MONDAY_NOON_UTC, 'America/Sao_Paulo'), { day: 1, minutes: 570 });
  const inbox = { working_hours_enabled: 1, timezone: 'America/Sao_Paulo' };
  const monday = [{ day_of_week: 1, closed_all_day: 0, open_minutes: 540, close_minutes: 1080 }];
  assert.equal(isOpen(inbox, monday, MONDAY_NOON_UTC), true);
  assert.equal(
    isOpen({ ...inbox, timezone: 'Asia/Tokyo' }, monday, MONDAY_NOON_UTC),
    false,
    'Monday 21:30 in Tokyo',
  );
  assert.equal(isOpen(inbox, [{ ...monday[0], closed_all_day: 1 }], MONDAY_NOON_UTC), false);
  assert.equal(isOpen(inbox, [], MONDAY_NOON_UTC), false, 'days without hours are closed');
  assert.equal(isOpen({ ...inbox, working_hours_enabled: 0 }, [], MONDAY_NOON_UTC), true);
  assert.throws(() => validateSchedule([monday[0], monday[0]]), /repetido/);
  assert.throws(() => validateSchedule([{ ...monday[0], open_minutes: 1100 }]), /abertura/);
  assert.doesNotThrow(() => validateSchedule([{ ...monday[0], closed_all_day: 1, open_minutes: 1100 }]));
  assert.throws(() => validateTimezone('Mars/Olympus'), /Fuso/);
});

test('automation conditions chain with and/or like Chatwoot', () => {
  const ctx = {
    content: 'Quero a segunda via do BOLETO',
    labels: ['vip'],
    status: 'open',
    assignee_id: null,
  };
  const cond = (attribute_key, filter_operator, values = [], query_operator = 'and') => ({
    attribute_key,
    filter_operator,
    values,
    query_operator,
  });
  assert.equal(matchesConditions([], ctx), true);
  assert.equal(matchesConditions([cond('content', 'contains', ['boleto'])], ctx), true);
  assert.equal(matchesConditions([cond('content', 'does_not_contain', ['boleto'])], ctx), false);
  assert.equal(matchesConditions([cond('labels', 'equal_to', ['VIP'])], ctx), true);
  assert.equal(matchesConditions([cond('labels', 'not_equal_to', ['vip'])], ctx), false);
  assert.equal(matchesConditions([cond('assignee_id', 'is_not_present')], ctx), true);
  assert.equal(matchesConditions([cond('assignee_id', 'is_present')], ctx), false);
  assert.equal(matchesConditions([cond('status', 'unknown_op', ['open'])], ctx), false);
  const orChain = [cond('status', 'equal_to', ['resolved'], 'or'), cond('content', 'contains', ['boleto'])];
  assert.equal(matchesConditions(orChain, ctx), true);
  const andChain = [cond('status', 'equal_to', ['resolved']), cond('content', 'contains', ['boleto'])];
  assert.equal(matchesConditions(andChain, ctx), false);
});

test('automation rules are validated and mapped from helpdesk events', () => {
  const ok = {
    event_name: 'message_created',
    conditions: [],
    actions: [{ action_name: 'resolve_conversation' }],
  };
  assert.doesNotThrow(() => validateRule(ok));
  assert.throws(() => validateRule({ ...ok, event_name: 'x' }), /Evento/);
  assert.throws(() => validateRule({ ...ok, actions: [] }), /ao menos/);
  assert.throws(() => validateRule({ ...ok, actions: [{ action_name: 'explode' }] }), /Ação/);
  assert.throws(
    () => validateRule({ ...ok, actions: [{ action_name: 'add_label', action_params: [] }] }),
    /parâmetro/,
  );
  assert.throws(
    () => validateRule({ ...ok, actions: [{ action_name: 'send_message', action_params: [' '] }] }),
    /vazia/,
  );
  const bad = (c) => validateRule({ ...ok, conditions: [{ values: ['x'], ...c }] });
  assert.throws(() => bad({ attribute_key: 'x', filter_operator: 'equal_to' }), /Condição/);
  assert.throws(() => bad({ attribute_key: 'status', filter_operator: 'x' }), /Operador/);
  assert.throws(() => bad({ attribute_key: 'status', filter_operator: 'equal_to', values: [] }), /valor/);

  assert.deepEqual(automationEventsFor('conversation.created', {}), ['conversation_created']);
  assert.deepEqual(automationEventsFor('message.created', { message_type: 'incoming' }), ['message_created']);
  assert.deepEqual(automationEventsFor('message.created', { message_type: 'activity' }), []);
  assert.deepEqual(automationEventsFor('message.created', { message_type: 'outgoing', private: true }), []);
  assert.deepEqual(automationEventsFor('conversation.status_changed', { status: 'resolved' }), [
    'conversation_resolved',
  ]);
  assert.deepEqual(automationEventsFor('conversation.status_changed', { status: 'open' }), [
    'conversation_opened',
  ]);
  assert.deepEqual(automationEventsFor('conversation.status_changed', { status: 'snoozed' }), []);
  assert.deepEqual(automationEventsFor('assignee.changed', {}), []);
});

test('CSAT answers are parsed from plain WhatsApp replies within 24 hours', () => {
  assert.deepEqual(parseRating('5'), { rating: 5, feedback: null });
  assert.deepEqual(parseRating('Nota 4 - atendimento rápido'), { rating: 4, feedback: 'atendimento rápido' });
  assert.deepEqual(parseRating(' 3, ok '), { rating: 3, feedback: 'ok' });
  assert.equal(parseRating('6'), null);
  assert.equal(parseRating('obrigado'), null);
  assert.equal(parseRating(null), null);
  const resolved = { status: 'resolved', csat_requested_at: 1000 };
  assert.equal(awaitingCsat(resolved, 1000 + CSAT_WINDOW_SECONDS), true);
  assert.equal(awaitingCsat(resolved, 1001 + CSAT_WINDOW_SECONDS), false);
  assert.equal(awaitingCsat({ ...resolved, status: 'open' }, 1000), false);
  assert.equal(awaitingCsat({ ...resolved, csat_requested_at: null }, 1000), false);
  assert.equal(awaitingCsat(null, 1000), false);
});

test('webhook events, retries and URLs follow the delivery policy', () => {
  assert.equal(webhookEventFor('assignee.changed'), 'conversation_updated');
  assert.equal(webhookEventFor('message.created'), 'message_created');
  assert.equal(webhookEventFor('presence.update'), null);
  assert.deepEqual([1, 2, 3, 4, 5].map(retryDelay), [30, 120, 600, 3600, null]);
  assert.equal(MAX_ATTEMPTS, 5);
  const ok = { url: 'https://example.com/hook', subscriptions: ['message_created'] };
  assert.doesNotThrow(() => validateWebhook(ok));
  assert.throws(() => validateWebhook({ ...ok, url: 'nota url' }), /URL inválida/);
  assert.throws(() => validateWebhook({ ...ok, url: 'ftp://example.com' }), /http/);
  assert.throws(() => validateWebhook({ ...ok, url: 'https://u:p@example.com' }), /credenciais/);
  assert.throws(() => validateWebhook({ ...ok, subscriptions: ['nope'] }), /eventos/);
  assert.throws(() => validateWebhook({ ...ok, subscriptions: [] }), /eventos/);
});

test('webhook sender signs timestamp and body with HMAC-SHA256', async () => {
  let request;
  const fakeFetch = async (url, init) => {
    request = { url, init };
    return new Response(null, { status: 204 });
  };
  const result = await webhookSender.post(
    'https://example.com/h',
    { event: 'message_created', a: 1 },
    's3cret',
    fakeFetch,
  );
  assert.deepEqual(result, { status: 204, ok: true });
  const { headers, body, redirect } = request.init;
  const expected = createHmac('sha256', 's3cret')
    .update(`${headers['X-Wamcp-Timestamp']}.${body}`)
    .digest('hex');
  assert.equal(headers['X-Wamcp-Signature'], `sha256=${expected}`);
  assert.equal(headers['X-Wamcp-Event'], 'message_created');
  assert.equal(redirect, 'manual', 'redirects are not followed');
  assert.match(webhookSender.secret(), /^[\w-]{32}$/);
  const failed = await webhookSender.post(
    'https://e.com',
    { event: 'x' },
    's',
    async () => new Response('', { status: 500 }),
  );
  assert.equal(failed.ok, false);
});
