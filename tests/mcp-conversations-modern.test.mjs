import { test } from 'node:test';
import assert from 'node:assert/strict';
import { protocolFixture } from './mcp-events-protocol-fixture.mjs';

test('helpdesk conversation tools are served on the modern MCP protocol too', async (t) => {
  const f = await protocolFixture(t);
  const bot = { bot: true, inboxId: 1 };
  const replies = [];
  f.service.bot = () => bot;
  f.service.act = async (_id, _token, _name, operation) => operation();
  f.service.helpdesk = {
    conversations: () => [{ display_id: 3, status: 'pending' }],
    reply: async (actor, displayId, body) => {
      replies.push({ actor, displayId, body });
      return { id: 9, ...body };
    },
  };
  const names = (await f.rpc('tools/list', {}, { credential: 'writer' })).body.result.tools.map(
    (tool) => tool.name,
  );
  for (const name of [
    'list_conversations',
    'get_conversation',
    'reply_conversation',
    'set_conversation_status',
  ])
    assert.ok(names.includes(name), name);
  const listed = (await f.rpc('tools/call', { name: 'list_conversations', arguments: { status: 'pending' } }))
    .body;
  assert.deepEqual(JSON.parse(listed.result.content[0].text), [{ display_id: 3, status: 'pending' }]);
  const reply = await f.rpc(
    'tools/call',
    { name: 'reply_conversation', arguments: { display_id: 3, content: 'Olá!' } },
    { credential: 'writer' },
  );
  assert.equal(reply.body.result.isError, undefined);
  assert.deepEqual(replies, [{ actor: bot, displayId: 3, body: { content: 'Olá!', private: false } }]);
  const denied = await f.rpc('tools/call', {
    name: 'reply_conversation',
    arguments: { display_id: 3, content: 'x' },
  });
  assert.equal(denied.body.result.isError, true, 'read-only credentials cannot reply');
  assert.equal(replies.length, 1);
});
