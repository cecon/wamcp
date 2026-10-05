import { sessionService } from './application/sessions.mjs';
import { mcpService } from './application/mcp.mjs';
import { oauthService } from './application/oauth.mjs';
import { oauthStore } from './adapters/outbound/sqlite/oauth-store.mjs';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { openStore } from './adapters/outbound/sqlite/store.mjs';
import { whatsappManager } from './adapters/outbound/whatsapp.mjs';
import { createApps } from './adapters/inbound/http.mjs';
import { eventService } from './application/events.mjs';
import { eventStore } from './adapters/outbound/sqlite/event-store.mjs';
import { eventWebhook } from './adapters/outbound/event-webhook.mjs';
const dir =
  process.env.WAMCP_DATA_DIR || path.join(process.env.LOCALAPPDATA || os.homedir(), 'com.cappyfy.wamcp');
mkdirSync(dir, { recursive: true });
const tokenFile = path.join(dir, 'admin.token');
if (!existsSync(tokenFile)) writeFileSync(tokenFile, randomBytes(32).toString('base64url'), { mode: 0o600 });
const adminToken = process.env.WAMCP_ADMIN_TOKEN || readFileSync(tokenFile, 'utf8').trim();
const store = openStore(dir);
const publicUrl = 'https://wamcp.cappyfy.com';
const oauth = oauthService(oauthStore(store.db), store, publicUrl);
const events = eventService(eventStore(store.db), eventWebhook(), {
  authorize: (id, principalId, kind) =>
    Boolean(
      store.session(id) &&
      (kind === 'oauth'
        ? oauth.eventPrincipal(id, principalId)
        : kind === 'token'
          ? store.eventPrincipal(id, principalId)
          : null),
    ),
});
const wa = whatsappManager(store, dir, {
  onMessage: (id, message) => events.publish(id, message),
  onLogout: (id) => events.disconnect(id),
});
const { admin, publicApp } = createApps({
  sessions: sessionService(store, wa, events),
  mcp: mcpService(store, wa, oauth),
  oauth,
  events,
  publicUrl,
  adminToken,
});
const adminServer = admin.listen(Number(process.env.WAMCP_ADMIN_PORT || 17381), '127.0.0.1');
const mcpServer = publicApp.listen(Number(process.env.WAMCP_MCP_PORT || 17382), '127.0.0.1');
for (const s of [adminServer, mcpServer])
  s.on('error', (error) => {
    console.error('Falha ao iniciar serviço:', error.code);
    process.exit(1);
  });
adminServer.on('listening', () => console.log('WA MCP: serviço local iniciado.'));
wa.restore();
events.start();
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await events.close();
  await wa.close();
  adminServer.close();
  mcpServer.close();
  store.close();
  process.exit(0);
}
process.on('SIGINT', close);
process.on('SIGTERM', close);
