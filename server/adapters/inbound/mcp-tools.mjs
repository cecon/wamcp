import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { jidSchema } from './schemas.mjs';
export function mcpTools(service, id, token, credential) {
  const server = new McpServer({ name: 'wamcp', version: '0.1.0' });
  const output = (data) => ({ content: [{ type: 'text', text: JSON.stringify(data) }] });
  const read = (name, description, schema, handler) =>
    server.registerTool(
      name,
      { description, inputSchema: schema, annotations: { readOnlyHint: true, destructiveHint: false } },
      async (args) => {
        return output(service.read(id, token, name, () => handler(args)));
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
    'Histórico local de uma conversa. before é timestamp Unix em segundos.',
    {
      jid: jidSchema,
      before: z.number().positive().optional(),
      limit: z.number().int().min(1).max(200).default(100),
    },
    (args) => service.messages(id, args.jid, args.before, args.limit),
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
        annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
      },
      async ({ jid, text }) => {
        if (!service.authenticate(id, credential))
          return { isError: true, content: [{ type: 'text', text: 'Token revogado' }] };
        try {
          return output(await service.send(id, token, jid, text));
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
