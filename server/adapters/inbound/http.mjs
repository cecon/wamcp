import express from 'express';
import { z } from 'zod';
import { adminSecurity } from './security.mjs';
import { adminRoutes } from './admin-routes.mjs';
import { mcpRoutes } from './mcp-routes.mjs';
export function createApps({ sessions, mcp, adminToken, publicUrl = 'https://wamcp.cappyfy.com' }) {
  if (!adminToken || adminToken.length < 32) throw new Error('Admin token must have at least 32 characters');
  const admin = express(),
    publicApp = express();
  for (const app of [admin, publicApp]) {
    app.disable('x-powered-by');
    app.use(express.json({ limit: '256kb' }));
  }
  adminSecurity(admin, adminToken);
  adminRoutes(admin, sessions, publicUrl);
  mcpRoutes(publicApp, mcp);
  for (const app of [admin, publicApp])
    app.use((error, _req, res, _next) => {
      if (res.headersSent) return;
      res.status(error instanceof z.ZodError ? 400 : 500).json({
        error: error instanceof z.ZodError ? 'Dados inválidos' : 'Não foi possível concluir a operação',
      });
    });
  return { admin, publicApp };
}
