import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';
import metadata from '../../../package.json' with { type: 'json' };
import { registerMcpTools } from './mcp-tools.mjs';
import { registerMcpEvents } from './mcp-events.mjs';
import { withToolSecurity } from './mcp-auth.mjs';

export async function modernMcp(req, res, service, token, credential, publicUrl, events) {
  const handler = createMcpHandler(
    () => {
      const server = new McpServer(
        { name: 'wamcp', version: metadata.version },
        { capabilities: { tools: { listChanged: false } } },
      );
      registerMcpTools(server, service, req.params.id, token, credential, publicUrl);
      if (events) registerMcpEvents(server, events, service, req.params.id, credential);
      return server;
    },
    { legacy: 'reject', maxRequestBodySize: 256 * 1024 },
  );
  // Keep the ChatGPT security extension present at both supported tool metadata locations.
  const nodeHandler = toNodeHandler({
    async fetch(request, options) {
      const response = await handler.fetch(request, options);
      if (!response.headers.get('content-type')?.includes('application/json')) return response;
      const body = withToolSecurity(await response.json());
      const headers = new Headers(response.headers);
      headers.delete('content-length');
      return Response.json(body, { status: response.status, headers });
    },
  });
  res.on('close', () => {
    void handler.close();
  });
  await nodeHandler(req, res, req.body);
}
