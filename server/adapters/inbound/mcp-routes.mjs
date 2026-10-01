import { rateLimit } from 'express-rate-limit';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { mcpTools } from './mcp-tools.mjs';
import { bearer } from './security.mjs';
export function mcpRoutes(publicApp, service) {
  publicApp.get('/healthz', (_req, res) => res.json({ service: 'wamcp', ok: true }));
  publicApp.use(
    '/mcp',
    rateLimit({ windowMs: 60000, limit: 240, standardHeaders: 'draft-8', legacyHeaders: false }),
  );
  publicApp.all('/mcp/:id', async (req, res) => {
    if (req.headers.origin) return res.status(403).json({ error: 'Browser access is not allowed' });
    const token = service.authenticate(req.params.id, bearer(req));
    if (!token) {
      res.setHeader('WWW-Authenticate', 'Bearer realm="wamcp"');
      return res.status(401).json({ error: 'Token inválido, expirado ou de outra sessão' });
    }
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ error: 'Use MCP Streamable HTTP POST' });
    }
    const id = req.params.id;
    const server = mcpTools(service, id, token, bearer(req));
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on('close', () => {
      transport.close().catch(() => {});
      server.close().catch(() => {});
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });
}
