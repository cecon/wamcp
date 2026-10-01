export const oauthScopes = ['whatsapp:read', 'whatsapp:send'];
export class OAuthFailure extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}
export function oauthRequire(condition, message, code = 'invalid_grant') {
  if (!condition) throw new OAuthFailure(code, message);
}
export function scopesFor(scope) {
  return scope === 'read_write' ? [...oauthScopes] : [oauthScopes[0]];
}
export function scopeFor(scopes) {
  return scopes.includes('whatsapp:send') ? 'read_write' : 'read';
}
export function validChatGptRedirect(value) {
  try {
    const u = new URL(value);
    return (
      u.protocol === 'https:' &&
      u.hostname === 'chatgpt.com' &&
      !u.port &&
      !u.username &&
      !u.password &&
      !u.hash &&
      !u.search &&
      (/^\/connector\/oauth\/[A-Za-z0-9_-]+$/.test(u.pathname) ||
        u.pathname === '/connector_platform_oauth_redirect')
    );
  } catch {
    return false;
  }
}
