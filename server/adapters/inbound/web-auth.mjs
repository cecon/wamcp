import { timingSafeEqual } from 'node:crypto';
import { ipKeyGenerator } from 'express-rate-limit';

export const SESSION_COOKIE = 'wamcp_session';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function readCookie(req, name) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return decodeURIComponent(value.join('='));
  }
  return null;
}

export function sessionCookie(value, maxAgeMs) {
  const age = Math.max(0, Math.floor(maxAgeMs / 1000));
  return `${SESSION_COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${age}`;
}

const same = (a, b) => {
  const x = Buffer.from(String(a || '')),
    y = Buffer.from(String(b || ''));
  return x.length > 0 && x.length === y.length && timingSafeEqual(x, y);
};

/** Behind the Cloudflare tunnel every request comes from loopback, so key limits by the visitor IP. */
export const clientKey = (req) => ipKeyGenerator(String(req.headers['cf-connecting-ip'] || req.ip || ''));

/** Only same-origin browser requests (or the public URL) may reach the helpdesk API. */
export function sameOrigin(publicUrl) {
  return (req, res, next) => {
    const origin = req.headers.origin;
    if (origin && origin !== publicUrl && origin !== `${req.protocol}://${req.headers.host}`)
      return res.status(403).json({ error: 'Origem não permitida' });
    next();
  };
}

/**
 * Authenticates helpdesk requests either by the `api_access_token` header (integrations, no cookies)
 * or by the session cookie, which additionally requires the CSRF header on state-changing requests.
 */
export function requireAgent(accounts) {
  return (req, res, next) => {
    const apiToken = req.headers['api_access_token'];
    if (apiToken) {
      const auth = accounts.authenticateApiToken(apiToken);
      if (!auth) return res.status(401).json({ error: 'Token inválido' });
      req.user = auth.user;
      return next();
    }
    const cookie = readCookie(req, SESSION_COOKIE);
    const auth = cookie && accounts.authenticateCookie(cookie);
    if (!auth) return res.status(401).json({ error: 'Faça login para continuar' });
    if (!SAFE_METHODS.has(req.method) && !same(req.headers['x-csrf-token'], auth.csrf))
      return res.status(403).json({ error: 'Token CSRF inválido' });
    req.user = auth.user;
    req.csrf = auth.csrf;
    next();
  };
}
