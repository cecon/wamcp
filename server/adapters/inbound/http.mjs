import express from 'express';
import { z } from 'zod';
import { adminSecurity } from './security.mjs';
import { adminRoutes } from './admin-routes.mjs';
import { mcpRoutes } from './mcp-routes.mjs';
import { oauthRoutes } from './oauth-routes.mjs';
import { HelpdeskError } from '../../domain/helpdesk.mjs';
import { sameOrigin } from './web-auth.mjs';
import { accountRoutes, bootstrapRoutes } from './account-routes.mjs';
import { conversationRoutes } from './conversation-routes.mjs';
import { catalogRoutes } from './catalog-routes.mjs';
import { automationRoutes } from './automation-routes.mjs';
import { webAppRoutes } from './web-app.mjs';
export function createApps({
  sessions,
  mcp,
  oauth,
  events,
  support,
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
  if (support) {
    bootstrapRoutes(admin, support.accounts, publicUrl);
    const api = express.Router();
    api.use(sameOrigin(publicUrl));
    accountRoutes(api, support.accounts);
    conversationRoutes(api, support.helpdesk);
    catalogRoutes(api, support);
    if (support.webhooks) automationRoutes(api, support);
    publicApp.use('/api/v1', api);
    webAppRoutes(publicApp, support.webDir);
  }
  for (const app of [admin, publicApp])
    app.use((error, req, res, _next) => {
      if (res.headersSent) return;
      if (error instanceof HelpdeskError) return res.status(error.status).json({ error: error.message });
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
