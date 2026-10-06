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
import { usersStore } from './adapters/outbound/sqlite/users-store.mjs';
import { helpdeskStore } from './adapters/outbound/sqlite/helpdesk-store.mjs';
import { passwordHasher } from './adapters/outbound/password.mjs';
import { eventBus } from './application/events.mjs';
import { accountService } from './application/accounts.mjs';
import { helpdeskService } from './application/helpdesk.mjs';
import { catalogService } from './application/catalog.mjs';
import { notificationService } from './application/notifications.mjs';
import { realtimeService } from './application/realtime.mjs';
import { findWebDir } from './adapters/inbound/web-app.mjs';
const dir =
  process.env.WAMCP_DATA_DIR || path.join(process.env.LOCALAPPDATA || os.homedir(), 'com.cappyfy.wamcp');
mkdirSync(dir, { recursive: true });
const tokenFile = path.join(dir, 'admin.token');
if (!existsSync(tokenFile)) writeFileSync(tokenFile, randomBytes(32).toString('base64url'), { mode: 0o600 });
const adminToken = process.env.WAMCP_ADMIN_TOKEN || readFileSync(tokenFile, 'utf8').trim();
const store = openStore(dir),
  wa = whatsappManager(store, dir);
const publicUrl = 'https://wamcp.cappyfy.com';
const oauth = oauthService(oauthStore(store.db), store, publicUrl);
const bus = eventBus(),
  users = usersStore(store.db),
  conversations = helpdeskStore(store.db);
const accounts = accountService({ users, helpdesk: conversations, hasher: passwordHasher, bus });
const helpdesk = helpdeskService({ helpdesk: conversations, users, whatsapp: wa, mirror: store, bus });
wa.subscribe({
  message: (sessionId, message) => helpdesk.ingest(sessionId, message),
  receipt: (sessionId, id, status) => helpdesk.receipt(sessionId, id, status),
});
const notifications = notificationService({ helpdesk: conversations, users, bus });
notifications.listen();
const snoozeTimer = setInterval(() => helpdesk.wakeSnoozed(), 60000);
const { admin, publicApp } = createApps({
  support: {
    accounts,
    helpdesk,
    catalog: catalogService({ helpdesk: conversations, bus }),
    notifications,
    realtime: realtimeService({ bus, users }),
    webDir: findWebDir(),
  },
  sessions: sessionService(store, wa),
  mcp: mcpService(store, wa, oauth, helpdesk),
  oauth,
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
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  clearInterval(snoozeTimer);
  await wa.close();
  adminServer.close();
  mcpServer.close();
  store.close();
  process.exit(0);
}
process.on('SIGINT', close);
process.on('SIGTERM', close);
