import { oauthRequire, scopeFor } from '../domain/oauth.mjs';
export function oauthTokenService(r, resourceFor) {
  function issue(grant) {
    const access = r.secret(),
      refresh = r.secret(),
      ttl = Math.min(3600000, grant.expires - r.now());
    oauthRequire(ttl > 0, 'Autorização expirada');
    r.prune();
    r.set('access', r.hash(access), { grantId: grant.id }, r.now() + ttl);
    r.set('refresh', r.hash(refresh), { grantId: grant.id, clientId: grant.clientId }, grant.expires);
    return {
      access_token: access,
      token_type: 'Bearer',
      expires_in: Math.floor(ttl / 1000),
      refresh_token: refresh,
      scope: grant.scopes.join(' '),
    };
  }
  return {
    issue,
    refresh(client, token, scopes, resource) {
      const reused = r.get('used_refresh', r.hash(token));
      if (reused?.clientId === client.client_id && reused.resource === resource?.toString()) {
        r.remove('grants', reused.grantId);
        oauthRequire(false, 'Refresh token reutilizado; autorize novamente');
      }
      return r.transaction(() => {
        const record = r.get('refresh', r.hash(token));
        oauthRequire(record?.clientId === client.client_id, 'Refresh token inválido');
        const grant = r.get('grants', record.grantId);
        oauthRequire(grant, 'Autorização revogada');
        oauthRequire(grant.resource === resource?.toString(), 'Audience inválida', 'invalid_target');
        oauthRequire(
          !scopes || scopes.every((s) => grant.scopes.includes(s)),
          'Escopo não autorizado',
          'invalid_scope',
        );
        if (scopes) {
          oauthRequire(scopes.includes('whatsapp:read'), 'Leitura necessária', 'invalid_scope');
          grant.scopes = scopes;
          r.set('grants', grant.id, grant, grant.expires);
        }
        r.remove('refresh', r.hash(token));
        r.set('used_refresh', r.hash(token), { ...record, resource: grant.resource }, grant.expires);
        return issue(grant);
      });
    },
    authenticate(id, token) {
      if (typeof token !== 'string' || token.length > 256) return null;
      const access = r.get('access', r.hash(token));
      const grant = access && r.get('grants', access.grantId);
      if (!grant || grant.sessionId !== id || grant.resource !== resourceFor(id)) return null;
      return {
        id: grant.id,
        session_id: id,
        scope: scopeFor(grant.scopes),
        clientId: grant.clientId,
        scopes: grant.scopes,
        resource: grant.resource,
      };
    },
    revoke(client, token) {
      const access = r.get('access', r.hash(token)) || r.get('refresh', r.hash(token));
      const grant = access && r.get('grants', access.grantId);
      if (grant?.clientId === client.client_id) r.remove('grants', grant.id);
    },
  };
}
