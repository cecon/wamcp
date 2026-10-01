import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
import { openStore } from '../server/adapters/outbound/sqlite/store.mjs';
import { oauthStore } from '../server/adapters/outbound/sqlite/oauth-store.mjs';
import { oauthService } from '../server/application/oauth.mjs';
import { sessionService } from '../server/application/sessions.mjs';
import { mcpService } from '../server/application/mcp.mjs';
import { createApps } from '../server/adapters/inbound/http.mjs';
export const origin = 'https://wamcp.cappyfy.com';
export const callback = 'https://chatgpt.com/connector/oauth/test-client';
export async function oauthFixture(t) {
  const dir = mkdtempSync(path.join(tmpdir(), 'wamcp-oauth-'));
  const store = openStore(dir),
    repository = oauthStore(store.db);
  const oauth = oauthService(repository, store, origin);
  const wa = { detail: () => ({}), send: async () => ({ id: 'sent' }) };
  const apps = createApps({
    sessions: sessionService(store, wa),
    mcp: mcpService(store, wa, oauth),
    oauth,
    adminToken: 'a'.repeat(64),
    publicUrl: origin,
  });
  const servers = await Promise.all(
    [apps.publicApp, apps.admin].map(
      (app) =>
        new Promise((resolve) => {
          const server = app.listen(0, '127.0.0.1', () => resolve(server));
        }),
    ),
  );
  const [url, adminUrl] = servers.map((s) => `http://127.0.0.1:${s.address().port}`);
  t.after(async () => {
    await Promise.all(
      servers.map(
        (s) =>
          new Promise((resolve) => {
            s.close(resolve);
            s.closeAllConnections();
          }),
      ),
    );
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const request = (route, body, headers = {}) =>
    fetch(`${url}${route}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers },
      body: new URLSearchParams(body),
      redirect: 'manual',
    });
  async function register(overrides = {}) {
    const response = await fetch(`${url}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_name: 'ChatGPT test',
        redirect_uris: [callback],
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        ...overrides,
      }),
    });
    return { status: response.status, ...(await response.json()) };
  }
  const a = store.createSession('Session A'),
    b = store.createSession('Session B');
  const resource = `${origin}/mcp/${a.id}`;
  async function begin(client, overrides = {}) {
    const verifier = randomBytes(32).toString('base64url');
    const params = {
      client_id: client.client_id,
      redirect_uri: callback,
      response_type: 'code',
      code_challenge_method: 'S256',
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      scope: 'whatsapp:read whatsapp:send',
      state: 'state-to-preserve',
      resource,
      ...overrides,
    };
    const response = await fetch(`${url}/authorize?${new URLSearchParams(params)}`, { redirect: 'manual' });
    const html = await response.text();
    return { response, html, request: html.match(/name="request" value="([^"]+)"/)?.[1], verifier };
  }
  async function approve(client, scope = 'read') {
    const flow = await begin(client);
    assert.equal(flow.response.status, 200, flow.html);
    const link = await fetch(`${adminUrl}/api/sessions/${a.id}/chatgpt/link`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${'a'.repeat(64)}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope }),
    });
    assert.equal(link.status, 200);
    const { code } = await link.json();
    const approved = await request('/oauth/approve', { request: flow.request, code }, { Origin: origin });
    assert.equal(approved.status, 303, await approved.text());
    const redirect = new URL(approved.headers.get('location'));
    assert.equal(redirect.searchParams.get('state'), 'state-to-preserve');
    return {
      code: redirect.searchParams.get('code'),
      code_verifier: flow.verifier,
      client_id: client.client_id,
      redirect_uri: callback,
      resource,
      grant_type: 'authorization_code',
    };
  }
  async function rpc(token, name = 'get_profile', session = a) {
    return fetch(`${url}/mcp/${session.id}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: name === 'tools/list' ? name : 'tools/call',
        params: name === 'tools/list' ? {} : { name, arguments: {} },
      }),
    });
  }
  return { store, repository, oauth, url, adminUrl, a, b, resource, request, register, begin, approve, rpc };
}
