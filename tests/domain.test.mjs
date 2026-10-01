import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mcpService } from '../server/application/mcp.mjs';
test('application rejects sending with read-only or cross-session credentials before calling the port', async () => {
  let sent = false;
  const service = mcpService(
    { audit() {} },
    {
      send: async () => {
        sent = true;
      },
    },
  );
  await assert.rejects(() => service.send('A', { session_id: 'A', scope: 'read' }, 'recipient', 'text'));
  await assert.rejects(() =>
    service.send('B', { session_id: 'A', scope: 'read_write' }, 'recipient', 'text'),
  );
  assert.equal(sent, false);
});
