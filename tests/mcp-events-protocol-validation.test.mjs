import { test } from 'node:test';
import assert from 'node:assert/strict';
import { envelope, protocolFixture, subscription, jid } from './mcp-events-protocol-fixture.mjs';

test('modern requests require session-bound credentials and reject browser origins and other verbs', async (t) => {
  const f = await protocolFixture(t);
  for (const method of [
    'server/discover',
    'tools/list',
    'events/list',
    'events/subscribe',
    'events/unsubscribe',
  ]) {
    const denied = await f.rpc(method, subscription, { credential: 'invalid' });
    assert.equal(denied.response.status, 401);
    assert.match(denied.response.headers.get('www-authenticate'), /oauth-protected-resource\/mcp\/session-a/);
    const foreign = await f.rpc(method, subscription, { target: f.url.replace('session-a', 'session-b') });
    assert.equal(foreign.response.status, 401);
  }
  const origin = await f.rpc('server/discover', {}, { headers: { Origin: 'https://example.org' } });
  assert.equal(origin.response.status, 403);
  for (const method of ['GET', 'DELETE']) {
    const other = await f.raw(undefined, { method });
    assert.equal(other.response.status, 405);
    assert.equal(other.response.headers.get('allow'), 'POST');
  }
  f.tokens.delete('reader');
  assert.equal((await f.rpc('events/list')).response.status, 401);
  assert.equal(f.calls.length, 0);
});

test('modern JSON-RPC validation rejects malformed ids, params, requests and batches without dispatch', async (t) => {
  const f = await protocolFixture(t);
  const base = { jsonrpc: '2.0', id: 1, method: 'events/list', params: { _meta: envelope() } };
  const cases = [
    null,
    123,
    'invalid-request',
    { ...base, jsonrpc: '1.0' },
    { ...base, id: null },
    { ...base, id: {} },
    { ...base, id: [] },
    { ...base, method: 123 },
    { ...base, params: [] },
    { ...base, params: null },
    [base],
  ];
  for (const body of cases) {
    const result = await f.raw(body);
    assert.equal(result.response.status, 400, JSON.stringify(body));
    assert.ok([-32600, -32602].includes(result.body.error.code), JSON.stringify(result.body));
  }
  const unknown = await f.rpc('events/missing');
  assert.equal(unknown.body.error.code, -32601);
  assert.equal(f.calls.length, 0);
});

test('modern protocol version, client metadata and routing headers are validated by the official SDK', async (t) => {
  const f = await protocolFixture(t);
  for (const _meta of [
    {},
    { ...envelope(), 'io.modelcontextprotocol/protocolVersion': 123 },
    { ...envelope(), 'io.modelcontextprotocol/clientCapabilities': [] },
    { ...envelope(), 'io.modelcontextprotocol/clientInfo': 'bad' },
  ]) {
    const malformed = await f.rpc('events/list', { _meta });
    assert.equal(malformed.response.status, 400);
    assert.equal(malformed.body.error.code, -32602);
  }
  const mismatch = await f.rpc('events/list', {}, { headers: { 'MCP-Protocol-Version': '2025-11-25' } });
  assert.equal(mismatch.response.status, 400);
  assert.equal(mismatch.body.error.code, -32020);
  const unsupported = await f.rpc(
    'events/list',
    {
      _meta: { ...envelope(), 'io.modelcontextprotocol/protocolVersion': '2099-01-01' },
    },
    { headers: { 'MCP-Protocol-Version': '2099-01-01' } },
  );
  assert.equal(unsupported.response.status, 400);
  assert.equal(unsupported.body.error.code, -32022);
  const methodMismatch = await f.rpc('events/list', {}, { headers: { 'MCP-Method': 'tools/list' } });
  assert.equal(methodMismatch.body.error.code, -32020);
  const nameMismatch = await f.rpc(
    'tools/call',
    { name: 'get_profile', arguments: {} },
    {
      headers: { 'MCP-Name': 'wrong' },
    },
  );
  assert.equal(nameMismatch.body.error.code, -32020);
  const missingName = await f.rpc(
    'tools/call',
    { name: 'get_profile', arguments: {} },
    {
      headers: { 'MCP-Name': '' },
    },
  );
  assert.equal(missingName.body.error.code, -32020);
  const noClientInfo = envelope();
  delete noClientInfo['io.modelcontextprotocol/clientInfo'];
  assert.equal((await f.rpc('events/list', { _meta: noClientInfo })).response.status, 200);
  assert.equal(f.calls.length, 0);
});

test('event argument validation rejects owner overrides and unsupported filters or delivery modes', async (t) => {
  const f = await protocolFixture(t);
  const cases = [
    {},
    { ...subscription, name: 'other.event' },
    { ...subscription, sessionId: 'session-b' },
    { ...subscription, principalId: 'other-principal' },
    { ...subscription, arguments: { sessionId: 'session-b' } },
    { ...subscription, arguments: { jid: '../invalid' } },
    { ...subscription, delivery: { ...subscription.delivery, mode: 'stream' } },
    { ...subscription, cursor: 'past-history' },
    { ...subscription, ttlMs: -1 },
    { ...subscription, ttlMs: '1000' },
  ];
  for (const params of cases) {
    const result = await f.rpc('events/subscribe', params);
    assert.equal(result.body.error.code, -32602, JSON.stringify(result.body));
  }
  const missingDestination = await f.rpc('events/unsubscribe', { name: 'message.created', arguments: {} });
  assert.equal(missingDestination.body.error.code, -32602);
  const invalidCursor = await f.rpc('events/list', { cursor: 'unknown' });
  assert.equal(invalidCursor.body.error.code, -32602);
  assert.equal(f.calls.length, 0);
});

test('credentials are resolved again before each event or tool operation', async (t) => {
  const f = await protocolFixture(t);
  let checks = 0;
  f.service.authenticate = () => (++checks === 1 ? { id: 'reader-id', scope: 'read' } : null);
  const revoked = await f.rpc('events/subscribe', subscription);
  assert.equal(revoked.body.error.code, -32001);
  assert.equal(f.calls.length, 0);
  checks = 0;
  f.service.authenticate = () => ({ id: 'writer-id', scope: ++checks === 1 ? 'read_write' : 'read' });
  const reduced = await f.rpc('tools/call', { name: 'send_message', arguments: { jid, text: 'blocked' } });
  assert.equal(reduced.body.result.isError, true);
  assert.match(reduced.body.result._meta['mcp/www_authenticate'][0], /insufficient_scope/);
  assert.equal(f.calls.length, 0);
});

test('event notifications without request ids do not create subscriptions', async (t) => {
  const f = await protocolFixture(t);
  const notification = await f.raw({
    jsonrpc: '2.0',
    method: 'events/subscribe',
    params: { ...subscription, _meta: envelope() },
  });
  assert.equal(notification.response.status, 202);
  assert.equal(notification.body, undefined);
  assert.equal(f.calls.length, 0);
});

test('malformed and oversized JSON produce safe protocol errors before dispatch', async (t) => {
  const f = await protocolFixture(t);
  for (const [body, status, code] of [
    ['{"jsonrpc":"2.0","secret":"never-expose",', 400, -32700],
    [JSON.stringify({ secret: 'x'.repeat(256 * 1024) }), 413, -32600],
  ]) {
    const response = await fetch(f.url, {
      method: 'POST',
      headers: { Authorization: 'Bearer reader', 'Content-Type': 'application/json' },
      body,
    });
    assert.equal(response.status, status);
    const result = await response.json();
    assert.equal(result.jsonrpc, '2.0');
    assert.equal(result.id, null);
    assert.equal(result.error.code, code);
    assert.doesNotMatch(JSON.stringify(result), /never-expose|xxxx|SyntaxError/);
  }
  assert.equal(f.calls.length, 0);
});
