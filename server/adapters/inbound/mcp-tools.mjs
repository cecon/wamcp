import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { jidSchema } from './schemas.mjs';
import metadata from '../../../package.json' with { type: 'json' };
import { authChallenge, authResult, toolSecurity } from './mcp-auth.mjs';
export function mcpTools(service, id, token, credential, publicUrl) {
  const server = new McpServer({ name: 'wamcp', version: metadata.version });
  const output = (data) => ({ content: [{ type: 'text', text: JSON.stringify(data) }] });
  const read = (name, description, schema, handler) =>
    server.registerTool(
      name,
      {
        description,
        inputSchema: schema,
        ...toolSecurity('whatsapp:read'),
        annotations: { readOnlyHint: true, destructiveHint: false },
      },
      async (args) => {
        const current = service.authenticate(id, credential);
        if (!current) return authResult(authChallenge(publicUrl, id));
        return output(service.read(id, current, name, () => handler(args)));
      },
    );
  const profileSecurity = toolSecurity('whatsapp:read');
  server.registerTool(
    'get_profile',
    {
      description: 'Identifica a sessão vinculada a esta credencial.',
      inputSchema: {},
      outputSchema: { id: z.string(), name: z.string() },
      ...profileSecurity,
      _meta: { ...profileSecurity._meta, 'openai/profile': true },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async () => {
      const current = service.authenticate(id, credential);
      if (!current) return authResult(authChallenge(publicUrl, id));
      const profile = service.read(id, current, 'get_profile', () => ({
        id,
        name: service.session(id).name,
      }));
      return { ...output(profile), structuredContent: profile };
    },
  );
  read('session_status', 'Estado da sessão do WhatsApp', {}, () => service.session(id));
  read(
    'list_chats',
    'Lista conversas sincronizadas da sessão',
    { query: z.string().max(200).optional() },
    (args) => service.chats(id, args.query),
  );
  read(
    'get_messages',
    'Histórico local. Para paginar, use ts e id da mensagem mais antiga como before e beforeId.',
    {
      jid: jidSchema,
      before: z.number().positive().optional(),
      beforeId: z.string().max(200).optional(),
      limit: z.number().int().min(1).max(200).default(100),
    },
    (args) => service.messages(id, args.jid, args.before, args.limit, args.beforeId),
  );
  read(
    'search_messages',
    'Busca textos no histórico sincronizado',
    { query: z.string().min(1).max(200), limit: z.number().int().min(1).max(200).default(100) },
    (args) => service.search(id, args.query, args.limit),
  );
  if (token.scope === 'read_write')
    server.registerTool(
      'send_message',
      {
        description:
          'Envia uma mensagem de texto. Use apenas quando o usuário autorizar o envio ao destinatário.',
        inputSchema: { jid: jidSchema, text: z.string().min(1).max(10000) },
        ...toolSecurity('whatsapp:send'),
        annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
      },
      async ({ jid, text }) => {
        const current = service.authenticate(id, credential);
        if (!current) return authResult(authChallenge(publicUrl, id));
        if (current.scope !== 'read_write')
          return authResult(authChallenge(publicUrl, id, 'insufficient_scope', 'whatsapp:send'));
        try {
          return output(await service.send(id, current, jid, text));
        } catch {
          return {
            isError: true,
            content: [{ type: 'text', text: 'Falha no envio. Verifique a conexão da sessão.' }],
          };
        }
      },
    );

  return server;
}
