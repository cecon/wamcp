import { z } from 'zod';
import { ProtocolError } from '@modelcontextprotocol/server';
import { EventError } from '../../domain/events.mjs';
import { jidSchema } from './schemas.mjs';

const meta = z.record(z.string(), z.unknown()).optional();
const identity = {
  name: z.literal('message.created'),
  arguments: z
    .object({ jid: jidSchema.max(200).optional() })
    .strict()
    .optional(),
  _meta: meta,
};
const destination = { mode: z.literal('webhook'), url: z.string().max(2048) };
const subscriptions = z
  .object({
    ...identity,
    delivery: z.object({ ...destination, secret: z.string().max(100) }).strict(),
    cursor: z.null().optional(),
    ttlMs: z.number().int().positive().nullable().optional(),
  })
  .strict();
const unsubscriptions = z
  .object({
    ...identity,
    delivery: z.object(destination).strict(),
  })
  .strict();
const catalog = z.object({ cursor: z.null().optional(), _meta: meta }).strict().default({});

export function registerMcpEvents(server, events, service, sessionId, credential) {
  server.server.registerCapabilities({ events: {} });
  const register = (method, params, operation) =>
    server.server.setRequestHandler(method, { params }, async (args) => {
      const token = service.authenticate(sessionId, credential);
      if (!token) throw new ProtocolError(-32001, 'Acesso ao evento revogado ou expirado');
      const owner = {
        sessionId,
        principalId: token.id,
        principalKind: token.clientId ? 'oauth' : 'token',
      };
      try {
        return await operation(owner, args);
      } catch (error) {
        if (error instanceof EventError) throw new ProtocolError(error.code, error.message, error.data);
        throw new ProtocolError(-32603, 'Não foi possível concluir a operação de evento');
      }
    });
  register('events/list', catalog, () => events.list());
  register('events/subscribe', subscriptions, (owner, params) => events.subscribe(owner, params));
  register('events/unsubscribe', unsubscriptions, (owner, params) => events.unsubscribe(owner, params));
}
