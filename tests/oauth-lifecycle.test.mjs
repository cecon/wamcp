import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openStore } from '../server/adapters/outbound/sqlite/store.mjs';
import { oauthStore } from '../server/adapters/outbound/sqlite/oauth-store.mjs';
import { oauthService } from '../server/application/oauth.mjs';
import { oauthFixture, origin, callback } from './oauth-fixture.mjs';
import { mcpTools } from '../server/adapters/inbound/mcp-tools.mjs';
import { mcpService } from '../server/application/mcp.mjs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
test('Refresh reuse revokes the token family; access expiry requires refresh', async (t) => {
  const f = await oauthFixture(t),
    client = await f.register();
  const tokens = await (await f.request('/token', await f.approve(client))).json();
  f.store.db.prepare("UPDATE oauth_items SET expires=0 WHERE bucket='access'").run();
  assert.equal((await f.rpc(tokens.access_token)).status, 401);
  const body = {
    client_id: client.client_id,
    grant_type: 'refresh_token',
    refresh_token: tokens.refresh_token,
    resource: f.resource,
  };
  const rotated = await f.request('/token', body);
  assert.equal(rotated.status, 200);
  const next = await rotated.json();
  assert.equal((await f.rpc(next.access_token)).status, 200);
  assert.equal((await f.request('/token', body)).status, 400);
  assert.equal((await f.rpc(next.access_token)).status, 401);
  assert.equal((await f.request('/token', { ...body, refresh_token: next.refresh_token })).status, 400);
});
test('OAuth client and grants survive SQLite reopen; authorization codes expire', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'wamcp-oauth-restart-'));
  let store = openStore(dir);
  try {
    let repository = oauthStore(store.db),
      oauth = oauthService(repository, store, origin);
    const s = store.createSession('Persistent');
    const client = oauth.registerClient({
      client_id: 'client',
      client_name: 'ChatGPT',
      redirect_uris: [callback],
      token_endpoint_auth_method: 'none',
    });
    const resource = `${origin}/mcp/${s.id}`;
    function authorize() {
      const pending = oauth.begin(client, {
        resource: new URL(resource),
        codeChallenge: 'x'.repeat(43),
        redirectUri: callback,
        scopes: ['whatsapp:read'],
      });
      return new URL(oauth.approve(pending.request, oauth.createLink(s.id, 'read').code)).searchParams.get(
        'code',
      );
    }
    const expired = authorize();
    store.db.prepare("UPDATE oauth_items SET expires=0 WHERE bucket='codes'").run();
    assert.throws(() => oauth.exchange(client, expired, callback, new URL(resource)));
    const tokens = oauth.exchange(client, authorize(), callback, new URL(resource));
    store.close();
    store = openStore(dir);
    repository = oauthStore(store.db);
    oauth = oauthService(repository, store, origin);
    assert.equal(oauth.getClient('client').client_name, 'ChatGPT');
    assert.equal(oauth.authenticate(s.id, tokens.access_token).session_id, s.id);
    assert.ok(oauth.refresh(client, tokens.refresh_token, undefined, new URL(resource)).access_token);
    store.db.prepare("UPDATE oauth_items SET expires=0 WHERE bucket='grants'").run();
    assert.equal(oauth.authenticate(s.id, tokens.access_token), null);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test('A revoked credential produces the ChatGPT tool-level authentication challenge', async (t) => {
  const f = await oauthFixture(t);
  const issued = f.store.issueToken(f.a.id, 'Reader', 'read');
  const service = mcpService(f.store, {});
  const server = mcpTools(service, f.a.id, service.authenticate(f.a.id, issued.token), issued.token, origin);
  const client = new Client({ name: 'challenge-test', version: '1.0.0' });
  const [left, right] = InMemoryTransport.createLinkedPair();
  t.after(async () => {
    await client.close();
    await server.close();
  });
  await server.connect(left);
  await client.connect(right);
  f.store.revoke(f.a.id, issued.id);
  const result = await client.callTool({ name: 'get_profile', arguments: {} });
  assert.equal(result.isError, true);
  assert.ok(result._meta['mcp/www_authenticate'][0].includes('resource_metadata='));
  assert.equal(result.structuredContent, undefined);
});
