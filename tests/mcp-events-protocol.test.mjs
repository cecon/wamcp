import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventError } from '../server/domain/events.mjs';
import { protocolFixture, subscription, jid, version } from './mcp-events-protocol-fixture.mjs';

test('modern discovery and tools work without initialize on the authenticated MCP endpoint', async (t) => {
  const f = await protocolFixture(t);
  const { response, body } = await f.rpc('server/discover');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('mcp-session-id'), null);
  assert.equal(body.result.resultType, 'complete');
  assert.deepEqual(body.result.supportedVersions, [version]);
  assert.deepEqual(body.result.capabilities.events, {});
  assert.ok(body.result.capabilities.tools);
  assert.equal(body.result._meta['io.modelcontextprotocol/serverInfo'].name, 'wamcp');
  const tools = (await f.rpc('tools/list')).body.result;
  assert.equal(tools.resultType, 'complete');
  assert.equal(tools.tools.length, 6);
  for (const tool of tools.tools) {
    assert.deepEqual(tool.securitySchemes, [{ type: 'oauth2', scopes: ['whatsapp:read'] }]);
    assert.deepEqual(tool._meta.securitySchemes, tool.securitySchemes);
    assert.equal(tool.annotations.readOnlyHint, true);
  }
  assert.equal(tools.tools.find((tool) => tool.name === 'get_profile')._meta['openai/profile'], true);
  const profile = (await f.rpc('tools/call', { name: 'get_profile', arguments: {} })).body;
  assert.equal(profile.result.resultType, 'complete');
  assert.deepEqual(profile.result.structuredContent, { id: 'session-a', name: 'Session A' });
  const messages = (await f.rpc('tools/call', { name: 'get_messages', arguments: { jid } })).body;
  assert.equal(JSON.parse(messages.result.content[0].text)[0].body, 'Visible message');
});

test('event discovery and lifecycle preserve stable owner identity and modern result envelopes', async (t) => {
  const f = await protocolFixture(t);
  const catalog = (await f.rpc('events/list')).body.result;
  assert.equal(catalog.resultType, 'complete');
  assert.equal(catalog.events[0].name, 'message.created');
  assert.deepEqual(catalog.events[0].delivery, ['webhook']);
  const subscribe = (await f.rpc('events/subscribe', subscription)).body.result;
  assert.equal(subscribe.resultType, 'complete');
  assert.equal(subscribe.id, 'sub-example');
  assert.equal(subscribe.cursor, null);
  assert.equal(subscribe.truncated, false);
  assert.deepEqual(f.calls[0].subscribe.owner, {
    sessionId: 'session-a',
    principalId: 'reader-id',
    principalKind: 'token',
  });
  assert.equal(JSON.stringify(f.calls[0].subscribe.owner).includes('Bearer'), false);
  const delivery = { mode: subscription.delivery.mode, url: subscription.delivery.url };
  const unsubscribe = (
    await f.rpc(
      'events/unsubscribe',
      {
        name: subscription.name,
        arguments: subscription.arguments,
        delivery,
      },
      { credential: 'oauth' },
    )
  ).body.result;
  assert.equal(unsubscribe.resultType, 'complete');
  assert.deepEqual(f.calls[1].unsubscribe.owner, {
    sessionId: 'session-a',
    principalId: 'grant-id',
    principalKind: 'oauth',
  });
  assert.equal(f.calls[1].unsubscribe.params.delivery.secret, undefined);
});

test('events are neither advertised nor served unless their service is configured', async (t) => {
  const f = await protocolFixture(t, { includeEvents: false });
  assert.equal((await f.rpc('server/discover')).body.result.capabilities.events, undefined);
  assert.equal((await f.rpc('events/list')).body.error.code, -32601);
  assert.ok((await f.rpc('tools/list')).body.result.tools.length);
});

test('modern calls retain read/write gating, security annotations and media', async (t) => {
  const f = await protocolFixture(t);
  const params = { name: 'send_message', arguments: { jid, text: 'Explicitly authorized test' } };
  const denied = await f.rpc('tools/call', params);
  assert.ok(denied.body.error || denied.body.result?.isError);
  assert.equal(f.calls.length, 0);
  const tools = (await f.rpc('tools/list', {}, { credential: 'writer' })).body.result.tools;
  const send = tools.find((tool) => tool.name === 'send_message');
  assert.equal(send.annotations.readOnlyHint, false);
  assert.deepEqual(send.securitySchemes[0].scopes, ['whatsapp:read', 'whatsapp:send']);
  const invalid = await f.rpc(
    'tools/call',
    { ...params, arguments: { jid: '../bad', text: 'x' } },
    {
      credential: 'writer',
    },
  );
  assert.equal(invalid.body.result.isError, true);
  assert.equal(f.calls.length, 0);
  assert.equal((await f.rpc('tools/call', params, { credential: 'writer' })).body.result.isError, undefined);
  assert.equal(f.calls[0].send[0], 'session-a');
  const media = (await f.rpc('tools/call', { name: 'get_media', arguments: { jid, messageId: 'audio' } }))
    .body;
  assert.deepEqual(media.result.content[1], { type: 'audio', mimeType: 'audio/ogg', data: 'AQIDBA==' });
  f.service.media = async () => {
    f.tokens.delete('reader');
    return { data: 'AQIDBA==', type: 'audio', mimeType: 'audio/ogg' };
  };
  const revoked = (await f.rpc('tools/call', { name: 'get_media', arguments: { jid, messageId: 'audio' } }))
    .body;
  assert.equal(revoked.result.isError, true);
  assert.ok(revoked.result._meta['mcp/www_authenticate']);
  assert.doesNotMatch(JSON.stringify(revoked), /AQIDBA/);
});

test('event errors preserve specified codes and safe callback reasons', async (t) => {
  const f = await protocolFixture(t);
  f.events.subscribe = async () => {
    throw new EventError('Falha ao verificar callback', -32015, 'timeout');
  };
  const callback = await f.rpc('events/subscribe', subscription);
  assert.equal(callback.body.error.code, -32015);
  assert.deepEqual(callback.body.error.data, { reason: 'timeout' });
  f.events.subscribe = async () => {
    throw new Error('internal-path secret bearer');
  };
  const internal = await f.rpc('events/subscribe', subscription);
  assert.equal(internal.body.error.code, -32603);
  assert.doesNotMatch(JSON.stringify(internal.body), /internal-path|secret bearer/);
});
