import { test } from 'node:test';
import assert from 'node:assert/strict';
import { oauthFixture } from './oauth-fixture.mjs';
test('event token principals are session scoped, expiring and revocable without retaining bearer secrets', async (t) => {
  const f = await oauthFixture(t),
    token = f.store.issueToken(f.a.id, 'Events', 'read');
  assert.deepEqual(
    { ...f.store.eventPrincipal(f.a.id, token.id) },
    { id: token.id, session_id: f.a.id, scope: 'read' },
  );
  assert.equal(f.store.eventPrincipal(f.b.id, token.id), null);
  f.store.db.prepare('UPDATE tokens SET expires=? WHERE id=?').run('2000-01-01', token.id);
  assert.equal(f.store.eventPrincipal(f.a.id, token.id), null);
  const next = f.store.issueToken(f.a.id, 'Events', 'read');
  f.store.revoke(f.a.id, next.id);
  assert.equal(f.store.eventPrincipal(f.a.id, next.id), null);
});
test('event OAuth principal survives access rotation but stops after grant revocation', async (t) => {
  const f = await oauthFixture(t),
    client = await f.register();
  const tokens = await (await f.request('/token', await f.approve(client))).json();
  const principal = f.oauth.authenticate(f.a.id, tokens.access_token);
  assert.ok(f.oauth.eventPrincipal(f.a.id, principal.id));
  assert.equal(f.oauth.eventPrincipal(f.b.id, principal.id), null);
  f.store.db.prepare("UPDATE oauth_items SET expires=0 WHERE bucket='access'").run();
  assert.equal(f.oauth.authenticate(f.a.id, tokens.access_token), null);
  assert.ok(f.oauth.eventPrincipal(f.a.id, principal.id));
  const next = f.oauth.refresh(client, tokens.refresh_token, undefined, new URL(f.resource));
  assert.equal(f.oauth.authenticate(f.a.id, next.access_token).id, principal.id);
  f.oauth.disconnect(f.a.id, principal.id);
  assert.equal(f.oauth.eventPrincipal(f.a.id, principal.id), null);
});
