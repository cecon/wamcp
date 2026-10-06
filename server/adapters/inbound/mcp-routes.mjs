import { rateLimit } from 'express-rate-limit';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isLegacyRequest } from '@modelcontextprotocol/server';
import { toWebRequest } from '@modelcontextprotocol/node';
import { mcpTools } from './mcp-tools.mjs';
import { registerConversationTools } from './mcp-conversations.mjs';
import { modernMcp } from './mcp-modern.mjs';
import { bearer } from './security.mjs';
import { authChallenge, withToolSecurity } from './mcp-auth.mjs';
export function mcpRoutes(publicApp, service, publicUrl, events) {
  publicApp.get('/healthz', (_req, res) => res.json({ service: 'wamcp', ok: true }));
  publicApp.use(
    '/mcp',
    rateLimit({ windowMs: 60000, limit: 240, standardHeaders: 'draft-8', legacyHeaders: false }),
  );
  publicApp.all('/mcp/:id', async (req, res) => {
    if (req.headers.origin) return res.status(403).json({ error: 'Browser access is not allowed' });
    const credential = bearer(req);
    const token = service.authenticate(req.params.id, credential);
    if (!token) {
      res.setHeader('WWW-Authenticate', authChallenge(publicUrl, req.params.id));
      return res.status(401).json({ error: 'Token inválido, expirado ou de outra sessão' });
    }
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ error: 'Use MCP Streamable HTTP POST' });
    }
    if (!(await isLegacyRequest(await toWebRequest(req, req.body), req.body)))
      return modernMcp(req, res, service, token, credential, publicUrl, events);
    const id = req.params.id;
    const server = mcpTools(service, id, token, credential, publicUrl);
    registerConversationTools(server, service, id, credential, publicUrl);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    const send = transport.send.bind(transport);
    transport.send = (message, options) => send(withToolSecurity(message), options);
    res.on('close', () => {
      transport.close().catch(() => {});
      server.close().catch(() => {});
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });
}
