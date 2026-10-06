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

/** Serves the agent web app at /app on the public listener. */
export function webAppRoutes(publicApp, webDir) {
  publicApp.get('/', (_req, res) => res.redirect('/app/'));
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
  if (!webDir) {
    publicApp.get('/app/', (_req, res) =>
      res.status(503).type('text').send('Interface web não foi gerada. Execute npm run build.'),
    );
    return;
  }
  publicApp.get('/app/', (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(webDir, 'agent.html'));
  });
  publicApp.use(
    '/app/assets',
    express.static(path.join(webDir, 'assets'), { immutable: true, maxAge: '365d', index: false }),
  );
}
