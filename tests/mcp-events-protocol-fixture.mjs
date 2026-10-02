import { createApps } from '../server/adapters/inbound/http.mjs';
import { eventDefinition } from '../server/domain/events.mjs';

export const version = '2026-07-28';
export const jid = '5511999999999@s.whatsapp.net';
export const subscription = {
  name: 'message.created',
  arguments: { jid },
  delivery: {
    mode: 'webhook',
    url: 'https://receiver.example/mcp-events/callback',
    secret: `whsec_${Buffer.alloc(32, 1).toString('base64')}`,
  },
  cursor: null,
};
export function envelope() {
  return {
    'io.modelcontextprotocol/protocolVersion': version,
    'io.modelcontextprotocol/clientCapabilities': {},
    'io.modelcontextprotocol/clientInfo': { name: 'events-test', version: '1.0.0' },
  };
}

export async function protocolFixture(t, { includeEvents = true } = {}) {
  const calls = [];
  const tokens = new Map([
    ['reader', { id: 'reader-id', scope: 'read' }],
    ['writer', { id: 'writer-id', scope: 'read_write' }],
    ['oauth', { id: 'grant-id', scope: 'read', clientId: 'client-id' }],
  ]);
  const service = {
    authenticate: (id, credential) => id === 'session-a' && tokens.get(credential),
    read: (id, token, name, operation) => {
      calls.push({ id, token, name });
      return operation();
    },
    session: (id) => ({ id, name: 'Session A' }),
    chats: () => [{ jid, name: 'Contact' }],
    messages: () => [{ id: 'message-a', body: 'Visible message' }],
    search: () => [{ id: 'message-a', body: 'Visible message' }],
    send: async (...args) => {
      calls.push({ send: args });
      return { id: 'sent-message' };
    },
    media: async () => ({ data: 'AQIDBA==', type: 'audio', mimeType: 'audio/ogg' }),
  };
  const events = {
    list: () => ({ events: [structuredClone(eventDefinition)] }),
    subscribe: async (owner, params) => {
      calls.push({ subscribe: { owner, params } });
      return { id: 'sub-example', refreshBefore: '2026-10-03T14:00:00Z', cursor: null, truncated: false };
    },
    unsubscribe: async (owner, params) => {
      calls.push({ unsubscribe: { owner, params } });
      return {};
    },
  };
  const { publicApp } = createApps({
    sessions: {},
    mcp: service,
    events: includeEvents ? events : undefined,
    adminToken: 'a'.repeat(64),
  });
  const server = publicApp.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.on('listening', resolve));
  const url = `http://127.0.0.1:${server.address().port}/mcp/session-a`;
  t.after(
    () =>
      new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      }),
  );
  async function raw(body, { credential = 'reader', headers = {}, target = url, method = 'POST' } = {}) {
    const response = await fetch(target, {
      method,
      headers: {
        Authorization: `Bearer ${credential}`,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'MCP-Protocol-Version': version,
        ...(body?.method ? { 'MCP-Method': body.method } : {}),
        ...(body?.params?.name ? { 'MCP-Name': body.params.name } : {}),
        ...headers,
      },
      ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
    });
    const text = await response.text();
    return { response, body: text ? JSON.parse(text) : undefined };
  }
  const rpc = (method, params = {}, options) =>
    raw(
      {
        jsonrpc: '2.0',
        id: 'request-1',
        method,
        params: { _meta: envelope(), ...params },
      },
      options,
    );
  return { service, events, calls, tokens, url, raw, rpc };
}
