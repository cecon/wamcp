import { test } from 'node:test';
import assert from 'node:assert/strict';
import { oauthFixture, origin, callback } from './oauth-fixture.mjs';
test('OAuth discovery, DCR, PKCE, session-bound tokens, profile and revocation', async (t) => {
  const f = await oauthFixture(t);
  const protectedResponse = await fetch(`${f.url}/mcp/${f.a.id}`, { method: 'POST' });
  assert.equal(protectedResponse.status, 401);
  assert.ok(
    protectedResponse.headers.get('www-authenticate').includes(`oauth-protected-resource/mcp/${f.a.id}`),
  );
  const metadata = await (await fetch(`${f.url}/.well-known/oauth-protected-resource/mcp/${f.a.id}`)).json();
  assert.equal(metadata.resource, f.resource);
  const auth = await (await fetch(`${f.url}/.well-known/oauth-authorization-server`)).json();
  assert.equal(auth.issuer, metadata.authorization_servers[0]);
  assert.deepEqual(auth.code_challenge_methods_supported, ['S256']);
  const client = await f.register();
  assert.equal(client.status, 201);
  const body = await f.approve(client);
  const tokenResponse = await f.request('/token', body);
  assert.equal(tokenResponse.status, 200);
  const tokens = await tokenResponse.json();
  assert.equal(tokens.scope, 'whatsapp:read');
  assert.equal(tokens.expires_in, 3600);
  const result = await (await f.rpc(tokens.access_token)).json();
  assert.deepEqual(result.result.structuredContent, { id: f.a.id, name: 'Session A' });
  const listed = await (await f.rpc(tokens.access_token, 'tools/list')).json();
  assert.ok(!listed.result.tools.some((tool) => tool.name === 'send_message'));
  const profile = listed.result.tools.find((tool) => tool.name === 'get_profile');
  assert.equal(profile._meta['openai/profile'], true);
  assert.equal(profile.securitySchemes[0].type, 'oauth2');
  assert.equal((await f.rpc(tokens.access_token, 'get_profile', f.b)).status, 401);
  assert.equal((await f.request('/token', body)).status, 400);
  const persisted = f.repository.get('clients', client.client_id);
  assert.equal(persisted.client_id, client.client_id);
  const stored = f.store.db
    .prepare("SELECT key,value FROM oauth_items WHERE bucket IN ('access','refresh','codes','links')")
    .all();
  assert.ok(!JSON.stringify(stored).includes(tokens.access_token));
  assert.ok(!JSON.stringify(stored).includes(tokens.refresh_token));
  const refreshed = await f.request('/token', {
    client_id: client.client_id,
    grant_type: 'refresh_token',
    refresh_token: tokens.refresh_token,
    resource: f.resource,
  });
  assert.equal(refreshed.status, 200);
  const next = await refreshed.json();
  assert.notEqual(next.refresh_token, tokens.refresh_token);
  assert.deepEqual(
    (await (await f.rpc(next.access_token)).json()).result.structuredContent,
    result.result.structuredContent,
  );
  const revoked = await f.request('/revoke', { client_id: client.client_id, token: next.refresh_token });
  assert.equal(revoked.status, 200);
  assert.equal((await f.rpc(tokens.access_token)).status, 401);
  assert.equal((await f.rpc(next.access_token)).status, 401);
});
test('OAuth rejects unsafe callbacks, missing resource, bad PKCE, client, audience and escalation', async (t) => {
  const f = await oauthFixture(t);
  for (const redirect of [
    'https://evil.example/callback',
    'http://chatgpt.com/connector/oauth/id',
    'https://chatgpt.com.evil.example/connector/oauth/id',
    `${callback}?next=https://evil.example`,
  ])
    assert.equal((await f.register({ redirect_uris: [redirect] })).status, 400);
  const client = await f.register(),
    other = await f.register();
  assert.equal((await f.register({ token_endpoint_auth_method: 'private_key_jwt' })).status, 400);
  const missing = await f.begin(client, { resource: origin });
  assert.equal(missing.response.status, 302);
  assert.equal(new URL(missing.response.headers.get('location')).searchParams.get('error'), 'invalid_target');
  assert.equal((await f.begin(client, { redirect_uri: 'https://evil.example' })).response.status, 400);
  const body = await f.approve(client);
  for (const change of [
    { code_verifier: 'x'.repeat(43) },
    { client_id: other.client_id },
    { resource: `${origin}/mcp/${f.b.id}` },
    { redirect_uri: 'https://evil.example' },
  ])
    assert.equal((await f.request('/token', { ...body, ...change })).status, 400);
  const tokens = await (await f.request('/token', body)).json();
  assert.ok(tokens.access_token);
  const refresh = {
    grant_type: 'refresh_token',
    client_id: client.client_id,
    refresh_token: tokens.refresh_token,
    resource: f.resource,
  };
  for (const change of [
    { scope: 'whatsapp:read whatsapp:send' },
    { resource: `${origin}/mcp/${f.b.id}` },
    { client_id: other.client_id },
  ])
    assert.equal((await f.request('/token', { ...refresh, ...change })).status, 400);
  assert.equal((await f.request('/token', refresh)).status, 200);
});
test('Consent requires local proof for the same session, origin, unexpired single-use codes', async (t) => {
  const f = await oauthFixture(t),
    client = await f.register({ client_name: '<script>alert(1)</script>' });
  const flow = await f.begin(client);
  assert.ok(!flow.html.includes('<script>'));
  assert.ok(flow.html.includes('&lt;script&gt;'));
  const wrong = f.oauth.createLink(f.b.id, 'read_write');
  assert.equal(
    (await f.request('/oauth/approve', { request: flow.request, code: wrong.code }, { Origin: origin }))
      .status,
    400,
  );
  const link = f.oauth.createLink(f.a.id, 'read');
  assert.equal(
    (
      await f.request(
        '/oauth/approve',
        { request: flow.request, code: link.code },
        { Origin: 'https://evil.example' },
      )
    ).status,
    403,
  );
  assert.equal(
    (await f.request('/oauth/approve', { request: flow.request, code: link.code }, { Origin: origin }))
      .status,
    303,
  );
  assert.equal(
    (await f.request('/oauth/approve', { request: flow.request, code: link.code }, { Origin: origin }))
      .status,
    400,
  );
  const another = await f.begin(client),
    expired = f.oauth.createLink(f.a.id, 'read');
  f.store.db.prepare("UPDATE oauth_items SET expires=0 WHERE bucket='links'").run();
  assert.equal(
    (await f.request('/oauth/approve', { request: another.request, code: expired.code }, { Origin: origin }))
      .status,
    400,
  );
  assert.equal((await fetch(`${f.url}/api/sessions/${f.a.id}/chatgpt/link`, { method: 'POST' })).status, 404);
});
test('Confidential clients persist without secret expiry and desktop revocation invalidates refresh', async (t) => {
  const f = await oauthFixture(t),
    client = await f.register({ token_endpoint_auth_method: 'client_secret_post' });
  assert.equal(client.client_secret_expires_at, 0);
  const body = await f.approve(client, 'read_write');
  const missingSecret = await f.request('/token', body);
  assert.equal(missingSecret.status, 400);
  assert.equal((await missingSecret.json()).error, 'invalid_client');
  const response = await f.request('/token', { ...body, client_secret: client.client_secret });
  assert.equal(response.status, 200);
  const tokens = await response.json();
  assert.equal(tokens.scope, 'whatsapp:read whatsapp:send');
  assert.ok(
    (await (await f.rpc(tokens.access_token, 'tools/list')).json()).result.tools.some(
      (tool) => tool.name === 'send_message',
    ),
  );
  const grants = f.oauth.connections(f.a.id);
  assert.equal(grants.length, 1);
  f.oauth.disconnect(f.b.id, grants[0].id);
  assert.ok(f.oauth.authenticate(f.a.id, tokens.access_token));
  f.oauth.disconnect(f.a.id, grants[0].id);
  assert.equal(f.oauth.authenticate(f.a.id, tokens.access_token), null);
  assert.equal(
    (
      await f.request('/token', {
        client_id: client.client_id,
        client_secret: client.client_secret,
        grant_type: 'refresh_token',
        refresh_token: tokens.refresh_token,
        resource: f.resource,
      })
    ).status,
    400,
  );
});
