import express from 'express';
import { z } from 'zod';
import { adminSecurity } from './security.mjs';
import { adminRoutes } from './admin-routes.mjs';
import { mcpRoutes } from './mcp-routes.mjs';
import { oauthRoutes } from './oauth-routes.mjs';
export function createApps({
  sessions,
  mcp,
  oauth,
  events,
  adminToken,
  publicUrl = 'https://wamcp.cappyfy.com',
}) {
  if (!adminToken || adminToken.length < 32) throw new Error('Admin token must have at least 32 characters');
  const admin = express(),
    publicApp = express();
  for (const app of [admin, publicApp]) {
    app.disable('x-powered-by');
    app.use(express.json({ limit: '256kb', strict: app === admin }));
  }
  adminSecurity(admin, adminToken);
  adminRoutes(admin, sessions, publicUrl);
  if (oauth) oauthRoutes(admin, publicApp, oauth, publicUrl);
  mcpRoutes(publicApp, mcp, publicUrl, events);
  for (const app of [admin, publicApp])
    app.use((error, req, res, _next) => {
      if (res.headersSent) return;
      const parseError = error.type === 'entity.parse.failed';
      const tooLarge = error.type === 'entity.too.large';
      if (parseError || tooLarge) {
        const status = tooLarge ? 413 : 400;
        if (app === publicApp && req.path.startsWith('/mcp/'))
          return res.status(status).json({
            jsonrpc: '2.0',
            id: null,
            error: {
              code: tooLarge ? -32600 : -32700,
              message: tooLarge ? 'Request body exceeds 256 KiB' : 'Parse error: invalid JSON',
            },
          });
        return res.status(status).json({ error: 'Dados inválidos' });
      }
      res.status(error instanceof z.ZodError ? 400 : 500).json({
        error: error instanceof z.ZodError ? 'Dados inválidos' : 'Não foi possível concluir a operação',
      });
    });
  return { admin, publicApp };
}
