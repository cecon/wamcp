import { test } from 'node:test';
import assert from 'node:assert/strict';
import { oauthFixture, origin } from './oauth-fixture.mjs';

test('desktop OAuth completes with PKCE and exact loopback callback binding', async (t) => {
  const f = await oauthFixture(t);
  const redirectUri = 'http://127.0.0.1:49152/callback';
  const client = await f.register({ redirect_uris: [redirectUri], client_name: 'Codex desktop' });
  assert.equal(client.status, 201);
  const flow = await f.begin(client, { redirect_uri: redirectUri });
  assert.equal(flow.response.status, 200);
  const link = f.oauth.createLink(f.a.id, 'read');
  const approved = await f.request(
    '/oauth/approve',
    { request: flow.request, code: link.code },
    { Origin: origin },
  );
  assert.equal(approved.status, 303);
  const redirect = new URL(approved.headers.get('location'));
  assert.equal(redirect.origin + redirect.pathname, redirectUri);
  const body = {
    grant_type: 'authorization_code',
    client_id: client.client_id,
    code: redirect.searchParams.get('code'),
    code_verifier: flow.verifier,
    redirect_uri: redirectUri,
    resource: f.resource,
  };
  assert.equal(
    (await f.request('/token', { ...body, redirect_uri: 'http://127.0.0.1:49153/callback' })).status,
    400,
  );
  assert.equal((await f.request('/token', { ...body, code_verifier: 'x'.repeat(43) })).status, 400);
  const response = await f.request('/token', body);
  assert.equal(response.status, 200);
  const tokens = await response.json();
  assert.equal(tokens.scope, 'whatsapp:read');
  assert.equal((await f.rpc(tokens.access_token)).status, 200);
  assert.equal((await f.rpc(tokens.access_token, 'get_profile', f.b)).status, 401);
});

test('desktop callbacks reject remote hosts, credentials, queries and unrelated paths', async (t) => {
  const f = await oauthFixture(t);
  for (const redirect of [
    'http://127.0.0.1/callback',
    'http://127.0.0.1:49152/other',
    'http://127.0.0.1.evil.example:49152/callback',
    'http://192.168.1.1:49152/callback',
    'http://user@127.0.0.1:49152/callback',
    'http://127.0.0.1:49152/callback?next=evil',
    'http://127.0.0.1:49152/callback#fragment',
  ])
    assert.equal((await f.register({ redirect_uris: [redirect] })).status, 400, redirect);
});
