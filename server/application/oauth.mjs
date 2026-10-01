import { oauthRequire, oauthScopes, scopesFor, scopeFor, validChatGptRedirect } from '../domain/oauth.mjs';
import { oauthTokenService } from './oauth-tokens.mjs';
const TEN_MINUTES = 600000;
export function oauthService(repository, sessions, publicUrl) {
  const r = repository,
    resourceFor = (id) => `${publicUrl}/mcp/${id}`;
  const tokens = oauthTokenService(r, resourceFor);
  function sessionFor(resource) {
    const prefix = `${publicUrl}/mcp/`;
    oauthRequire(
      typeof resource === 'string' && resource.startsWith(prefix),
      'Recurso inválido',
      'invalid_target',
    );
    const id = resource.slice(prefix.length);
    oauthRequire(Boolean(sessions.session(id)), 'Sessão não encontrada', 'invalid_target');
    return id;
  }
  return {
    ...tokens,
    getClient: (id) => r.get('clients', id),
    registerClient(client) {
      oauthRequire(
        client.redirect_uris.length > 0 &&
          client.redirect_uris.length <= 5 &&
          client.redirect_uris.every(validChatGptRedirect),
        'Callback deve ser o endereço HTTPS do ChatGPT',
        'invalid_client_metadata',
      );
      oauthRequire(
        ['none', 'client_secret_post', undefined].includes(client.token_endpoint_auth_method),
        'Método de autenticação não suportado',
        'invalid_client_metadata',
      );
      oauthRequire(
        !client.client_name || client.client_name.length <= 120,
        'Nome de cliente inválido',
        'invalid_client_metadata',
      );
      const registered = {
        ...client,
        token_endpoint_auth_method: client.token_endpoint_auth_method || 'client_secret_post',
      };
      r.set('clients', client.client_id, registered);
      return registered;
    },
    createLink(id, scope) {
      oauthRequire(Boolean(sessions.session(id)), 'Sessão não encontrada');
      r.prune();
      const code = r.secret(),
        expires = r.now() + TEN_MINUTES;
      r.set('links', r.hash(code), { sessionId: id, scope }, expires);
      return { code, expires: new Date(expires).toISOString(), resource: resourceFor(id) };
    },
    begin(client, params) {
      const resource = params.resource?.toString();
      const sessionId = sessionFor(resource);
      const scopes = params.scopes?.length ? params.scopes : ['whatsapp:read'];
      oauthRequire(
        scopes.every((s) => oauthScopes.includes(s)),
        'Escopo inválido',
        'invalid_scope',
      );
      oauthRequire(
        /^[A-Za-z0-9_-]{43}$/.test(params.codeChallenge),
        'PKCE S256 obrigatório',
        'invalid_request',
      );
      const request = r.secret();
      r.prune();
      const value = {
        clientId: client.client_id,
        clientName: client.client_name || 'Cliente ChatGPT',
        sessionId,
        resource,
        scopes,
        redirectUri: params.redirectUri,
        state: params.state,
        challenge: params.codeChallenge,
      };
      r.set('pending', r.hash(request), value, r.now() + TEN_MINUTES);
      return { request, ...value };
    },
    approve(request, linkCode) {
      return r.transaction(() => {
        const pending = r.get('pending', r.hash(request)),
          link = r.get('links', r.hash(linkCode));
        oauthRequire(
          pending && link && pending.sessionId === link.sessionId,
          'Código inválido, expirado ou de outra sessão',
        );
        const scopes = pending.scopes.filter((s) => scopesFor(link.scope).includes(s));
        oauthRequire(scopes.includes('whatsapp:read'), 'Permissão de leitura necessária', 'invalid_scope');
        const code = r.secret();
        r.set('codes', r.hash(code), { ...pending, scopes }, r.now() + 60000);
        r.remove('pending', r.hash(request));
        r.remove('links', r.hash(linkCode));
        const redirect = new URL(pending.redirectUri);
        redirect.searchParams.set('code', code);
        if (pending.state !== undefined) redirect.searchParams.set('state', pending.state);
        return redirect.toString();
      });
    },
    challenge(client, code) {
      const data = r.get('codes', r.hash(code));
      oauthRequire(data?.clientId === client.client_id, 'Código inválido');
      return data.challenge;
    },
    exchange(client, code, redirectUri, resource) {
      return r.transaction(() => {
        const data = r.get('codes', r.hash(code));
        oauthRequire(
          data?.clientId === client.client_id && data.redirectUri === redirectUri,
          'Código ou callback inválido',
        );
        oauthRequire(data.resource === resource?.toString(), 'Audience inválida', 'invalid_target');
        r.remove('codes', r.hash(code));
        const grant = {
          id: r.secret(),
          clientId: client.client_id,
          clientName: data.clientName,
          sessionId: data.sessionId,
          resource: data.resource,
          scopes: data.scopes,
          created: new Date(r.now()).toISOString(),
          expires: r.now() + 90 * 86400000,
        };
        r.set('grants', grant.id, grant, grant.expires);
        return tokens.issue(grant);
      });
    },
    connections(id) {
      return r
        .list('grants')
        .filter((g) => g.sessionId === id)
        .map((g) => ({
          id: g.id,
          name: g.clientName,
          scope: scopeFor(g.scopes),
          created: g.created,
          expires: new Date(g.expires).toISOString(),
        }));
    },
    disconnect(id, grantId) {
      const g = r.get('grants', grantId);
      if (g?.sessionId === id) r.remove('grants', grantId);
    },
  };
}
