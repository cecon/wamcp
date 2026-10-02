import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  Browsers,
  fetchLatestBaileysVersion,
} from '@whiskeysockets/baileys';
import QRCode from 'qrcode';
import pino from 'pino';
import path from 'node:path';
import { rm } from 'node:fs/promises';
import { downloadMedia } from './media-download.mjs';
import { MediaError } from '../../domain/media.mjs';
import { persistLiveMessages } from './whatsapp-events.mjs';

export function whatsappManager(store, dir, { onMessage, onLogout } = {}) {
  const connections = new Map();
  const logger = pino({ level: 'silent' });
  const current = (id) => connections.get(id);
  async function connect(id) {
    if (!store.session(id)) throw new Error('Sessão não encontrada');
    if (current(id)?.socket || current(id)?.starting) return;
    const entry = { starting: true, qr: null, socket: null, timer: null, stopped: false, error: null };
    connections.set(id, entry);
    store.status(id, 'connecting');
    try {
      const { state, saveCreds } = await useMultiFileAuthState(path.join(dir, 'auth', id));
      if (entry.stopped) return;
      const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: undefined }));
      if (entry.stopped) return;
      const socket = makeWASocket({
        auth: state,
        logger,
        browser: Browsers.ubuntu('Chrome'),
        syncFullHistory: true,
        markOnlineOnConnect: false,
        ...(version ? { version } : {}),
      });
      entry.socket = socket;
      entry.starting = false;
      socket.ev.on('creds.update', () => {
        void saveCreds().catch(() => {
          entry.error = 'Falha ao salvar credenciais locais.';
        });
      });
      socket.ev.on('messaging-history.set', ({ chats, contacts, messages }) => {
        for (const c of chats) store.chat(id, c);
        for (const c of contacts) store.chat(id, c);
        for (const m of messages) store.message(id, m);
      });
      socket.ev.on('chats.upsert', (chats) => chats.forEach((c) => store.chat(id, c)));
      socket.ev.on('chats.update', (chats) => chats.forEach((c) => store.chat(id, c)));
      socket.ev.on('contacts.upsert', (contacts) => contacts.forEach((c) => store.chat(id, c)));
      socket.ev.on('messages.upsert', (update) => {
        if (current(id) !== entry || entry.stopped) return;
        persistLiveMessages(store, id, update, onMessage);
      });
      socket.ev.on('connection.update', async (update) => {
        if (current(id) !== entry || entry.stopped) return;
        if (update.qr) {
          const qr = await QRCode.toDataURL(update.qr, { margin: 2, width: 280 });
          if (current(id) !== entry || entry.stopped) return;
          entry.qr = qr;
          store.status(id, 'qr');
        }
        if (update.connection === 'open') {
          entry.qr = null;
          store.status(id, 'connected', socket.user?.id?.split(':')[0]);
        }
        if (update.connection === 'close') {
          entry.socket = null;
          entry.qr = null;
          const code = update.lastDisconnect?.error?.output?.statusCode;
          if (code === DisconnectReason.loggedOut) {
            onLogout?.(id);
            store.status(id, 'logged_out');
            await rm(path.join(dir, 'auth', id), { recursive: true, force: true });
          } else if (!entry.stopped) {
            store.status(id, 'reconnecting');
            entry.timer = setTimeout(
              () => connect(id).catch(() => {}),
              code === DisconnectReason.restartRequired ? 500 : 5000,
            );
          }
        }
      });
    } catch (error) {
      entry.starting = false;
      entry.error = 'Não foi possível conectar ao WhatsApp. Tente novamente.';
      store.status(id, 'error');
      throw error;
    }
  }
  async function stop(id, logout = false) {
    const e = current(id);
    if (e) {
      e.stopped = true;
      clearTimeout(e.timer);
      if (logout && e.socket) await e.socket.logout().catch(() => {});
      e.socket?.end(undefined);
      connections.delete(id);
    }
    if (logout) await rm(path.join(dir, 'auth', id), { recursive: true, force: true });
    store.status(id, 'disconnected');
  }
  return {
    connect,
    stop,
    detail: (id) => ({ qr: current(id)?.qr || null, error: current(id)?.error || null }),
    async media(id, message) {
      const socket = current(id)?.socket;
      if (store.session(id)?.status !== 'connected' || !socket)
        throw new MediaError('Conecte a sessão ao WhatsApp para baixar o anexo.');
      return downloadMedia(message, { logger, reuploadRequest: socket.updateMediaMessage });
    },
    async send(id, jid, text) {
      const socket = current(id)?.socket;
      if (store.session(id)?.status !== 'connected' || !socket) throw new Error('Sessão desconectada');
      const result = await socket.sendMessage(jid, { text });
      if (!result?.key?.id) throw new Error('Envio sem confirmação');
      if (result) store.message(id, result);
      return { id: result?.key?.id };
    },
    async restore() {
      for (const s of store.sessions()) {
        try {
          const { existsSync } = await import('node:fs');
          if (existsSync(path.join(dir, 'auth', s.id, 'creds.json'))) await connect(s.id);
        } catch {}
      }
    },
    async close() {
      for (const id of connections.keys()) await stop(id);
    },
  };
}
