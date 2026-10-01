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
export function validOAuthRedirect(value) {
  try {
    const u = new URL(value);
    if (u.username || u.password || u.hash || u.search) return false;
    if (u.protocol === 'http:' && u.hostname === '127.0.0.1')
      return Boolean(u.port) && /^\/callback(?:\/[A-Za-z0-9_-]{1,128})?$/.test(u.pathname);
    return (
      u.protocol === 'https:' &&
      u.hostname === 'chatgpt.com' &&
      !u.port &&
      (/^\/connector\/oauth\/[A-Za-z0-9_-]+$/.test(u.pathname) ||
        u.pathname === '/connector_platform_oauth_redirect')
    );
  } catch {
    return false;
  }
}
