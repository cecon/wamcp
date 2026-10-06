import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openStore } from '../server/adapters/outbound/sqlite/store.mjs';
import { composeHelpdesk } from '../server/compose-helpdesk.mjs';
import { sessionService } from '../server/application/sessions.mjs';
import { mcpService } from '../server/application/mcp.mjs';
import { createApps } from '../server/adapters/inbound/http.mjs';

export const ADMIN_TOKEN = 'a'.repeat(64);
export const PASSWORD = 'senha-segura-123';

/** Full helpdesk stack over a temporary SQLite file and an in-memory WhatsApp port. */
export async function helpdeskFixture(t, { beforeStart, webDir } = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'wamcp-helpdesk-'));
  if (beforeStart) beforeStart(dir);
  const store = openStore(dir);
  const sent = [],
    events = [];
  let nextId = 0;
  const wa = {
    detail: () => ({ qr: null }),
    newMessageId: () => `OUT${++nextId}`,
    fail: false,
    async send(sessionId, jid, text, options) {
      if (wa.fail) throw new Error('Sessão desconectada');
      sent.push({ sessionId, jid, text, ...options });
      return { id: options?.messageId };
    },
  };
  let clock = 1_800_000_000;
  const posts = [];
  const sender = {
    secret: () => 'test-secret',
    respond: () => ({ ok: true, status: 200 }),
    async post(url, body, secret) {
      posts.push({ url, body, secret });
      return sender.respond(url, body);
    },
  };
  const {
    bus,
    users,
    repository: conversations,
    helpdesk,
    support,
  } = composeHelpdesk({
    store,
    whatsapp: wa,
    sender,
    now: () => clock,
    webDir: webDir ?? undefined,
  });
  bus.subscribe((e) => events.push(e));
  const { accounts } = support;
  const apps = createApps({
    sessions: sessionService(store, wa),
    mcp: mcpService(store, wa, undefined, helpdesk),
    support,
    adminToken: ADMIN_TOKEN,
  });
  const servers = await Promise.all(
    [apps.admin, apps.publicApp].map(
      (app) =>
        new Promise((resolve) => {
          const server = app.listen(0, '127.0.0.1', () => resolve(server));
        }),
    ),
  );
  const [adminUrl, publicUrl] = servers.map((s) => `http://127.0.0.1:${s.address().port}`);
  t.after(async () => {
    await Promise.all(
      servers.map(
        (s) =>
          new Promise((resolve) => {
            s.close(resolve);
            s.closeAllConnections();
          }),
      ),
    );
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const admin = (route, init = {}) =>
    fetch(adminUrl + route, {
      ...init,
      headers: {
        authorization: `Bearer ${ADMIN_TOKEN}`,
        'content-type': 'application/json',
        ...init.headers,
      },
    });
  /** Logs in and returns a client that sends the session cookie and CSRF header like the browser UI. */
  async function login(email, password = PASSWORD) {
    const res = await fetch(publicUrl + '/api/v1/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (res.status !== 200) return { status: res.status };
    const cookie = res.headers.get('set-cookie').split(';')[0];
    const { csrf, user } = await res.json();
    const call = async (method, route, body, extra = {}) => {
      const r = await fetch(publicUrl + '/api/v1' + route, {
        method,
        headers: { cookie, 'x-csrf-token': csrf, 'content-type': 'application/json', ...extra },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await r.text();
      return { status: r.status, body: text ? JSON.parse(text) : null };
    };
    return {
      status: 200,
      user,
      cookie,
      csrf,
      get: (route) => call('GET', route),
      post: (route, body = {}, extra) => call('POST', route, body, extra),
      patch: (route, body) => call('PATCH', route, body),
      put: (route, body) => call('PUT', route, body),
      del: (route, body) => call('DELETE', route, body),
    };
  }
  async function bootstrap(email = 'admin@example.com') {
    const res = await admin('/api/helpdesk/bootstrap', {
      method: 'POST',
      body: JSON.stringify({ name: 'Admin', email, password: PASSWORD }),
    });
    if (res.status !== 201) throw new Error(`bootstrap ${res.status}`);
    return login(email);
  }
  /** Simulates a live WhatsApp message arriving through the Baileys listener. */
  function incoming(
    sessionId,
    { id, jid = '5511988887777@s.whatsapp.net', body = 'Olá', fromMe = false, ts, name = 'Cliente' },
  ) {
    const message = {
      key: { id, remoteJid: jid, fromMe },
      message: { conversation: body },
      messageTimestamp: ts ?? clock,
      pushName: fromMe ? undefined : name,
    };
    const described = store.message(sessionId, message);
    return helpdesk.ingest(sessionId, described);
  }
  return {
    dir,
    store,
    users,
    conversations,
    helpdesk,
    accounts,
    wa,
    sent,
    events,
    publicUrl,
    adminUrl,
    admin,
    login,
    bootstrap,
    incoming,
    support,
    sender,
    posts,
    /** Lets asynchronous listeners (automations, auto-replies) finish their queued work. */
    settle: () => new Promise((resolve) => setTimeout(resolve, 30)),
    tick: (seconds) => (clock += seconds),
    now: () => clock,
  };
}
