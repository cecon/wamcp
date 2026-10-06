import express from 'express';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
/** Built agent UI: `web/` in the desktop runtime, `dist/` in development. */
export function findWebDir() {
  return [path.resolve(here, '../../../web'), path.resolve(here, '../../../dist')].find((dir) =>
    existsSync(path.join(dir, 'agent.html')),
  );
}

const CSP = [
  "default-src 'self'",
  "connect-src 'self'",
  "img-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
].join('; ');

/** Serves the agent web app at /app on the public listener; `webDir` is a path or a resolver. */
export function webAppRoutes(publicApp, webDir) {
  publicApp.get('/', (_req, res) => res.redirect('/app/'));
  // The source page is agent.html (what Vite serves in dev); on the backend it lives at /app/.
  publicApp.get('/agent.html', (_req, res) => res.redirect('/app/'));
  // Non-strict routing matches "/app/" here too; only the bare path needs the trailing-slash redirect.
  publicApp.get('/app', (req, res, next) =>
    req.originalUrl.split('?')[0] === '/app' ? res.redirect('/app/') : next(),
  );
  publicApp.use('/app', (req, res, next) => {
    res.setHeader('Content-Security-Policy', CSP);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
  });
  // Resolved per request so a UI rebuilt while the service runs is picked up without a restart.
  const resolveDir = typeof webDir === 'function' ? webDir : () => webDir;
  const assets = new Map();
  publicApp.get('/app/', (_req, res) => {
    const dir = resolveDir();
    if (!dir)
      return res.status(503).type('text').send('Interface web não foi gerada. Execute npm run build.');
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(dir, 'agent.html'));
  });
  publicApp.use('/app/assets', (req, res, next) => {
    const dir = resolveDir();
    if (!dir) return res.sendStatus(404);
    if (!assets.has(dir))
      assets.set(
        dir,
        express.static(path.join(dir, 'assets'), { immutable: true, maxAge: '365d', index: false }),
      );
    return assets.get(dir)(req, res, next);
  });
}
