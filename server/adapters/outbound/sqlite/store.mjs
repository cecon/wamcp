import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { mediaStore } from './media-store.mjs';
import { migrate } from './migrations.mjs';
import { describeWaMessage } from '../wa-message.mjs';

export const hashToken = (value) => createHash('sha256').update(value).digest('hex');
export function openStore(dir) {
  mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(path.join(dir, 'wamcp.sqlite'));
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY,name TEXT NOT NULL,phone TEXT,status TEXT NOT NULL DEFAULT 'disconnected',created TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS chats(session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,jid TEXT NOT NULL,name TEXT,updated INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(session_id,jid));
    CREATE TABLE IF NOT EXISTS messages(session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,jid TEXT NOT NULL,id TEXT NOT NULL,sender TEXT,body TEXT NOT NULL,kind TEXT NOT NULL,from_me INTEGER NOT NULL,ts INTEGER NOT NULL,PRIMARY KEY(session_id,jid,id));
    CREATE INDEX IF NOT EXISTS message_history ON messages(session_id,jid,ts DESC);
    CREATE TABLE IF NOT EXISTS tokens(id TEXT PRIMARY KEY,session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,name TEXT NOT NULL,hash TEXT UNIQUE NOT NULL,scope TEXT NOT NULL,created TEXT NOT NULL,expires TEXT NOT NULL,last_used TEXT);
    CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY,session_id TEXT,token_id TEXT,action TEXT NOT NULL,at TEXT NOT NULL);
  `);
  migrate(db);
  db.prepare("UPDATE sessions SET status='disconnected'").run();
  const media = mediaStore(db);
  return {
    db,
    media: (s, jid, id) => media.get(s, jid, id),
    sessions: () =>
      db
        .prepare(
          'SELECT s.*, (SELECT COUNT(*) FROM messages WHERE session_id=s.id) AS message_count FROM sessions s ORDER BY created',
        )
        .all(),
    session: (id) => db.prepare('SELECT * FROM sessions WHERE id=?').get(id),
    createSession(name) {
      const id = randomUUID();
      db.prepare('INSERT INTO sessions(id,name,created) VALUES(?,?,?)').run(
        id,
        name,
        new Date().toISOString(),
      );
      return this.session(id);
    },
    status(id, status, phone = null) {
      db.prepare('UPDATE sessions SET status=?,phone=COALESCE(?,phone) WHERE id=?').run(status, phone, id);
    },
    chat(s, c) {
      if (!c.id) return;
      db.prepare(
        'INSERT INTO chats(session_id,jid,name,updated) VALUES(?,?,?,?) ON CONFLICT(session_id,jid) DO UPDATE SET name=COALESCE(excluded.name,chats.name),updated=MAX(chats.updated,excluded.updated)',
      ).run(s, c.id, c.name || c.subject || c.notify || null, Number(c.conversationTimestamp || 0));
    },
    message(s, m) {
      const d = describeWaMessage(m);
      if (!d) return undefined;
      const existing = db
        .prepare('SELECT 1 FROM messages WHERE session_id=? AND jid=? AND id=?')
        .get(s, d.jid, d.id);
      this.chat(s, { id: d.jid, conversationTimestamp: d.ts });
      db.prepare(
        'INSERT INTO messages(session_id,jid,id,sender,body,kind,from_me,ts) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(session_id,jid,id) DO UPDATE SET body=excluded.body,kind=excluded.kind',
      ).run(s, d.jid, d.id, d.sender, d.body, d.kind, d.fromMe ? 1 : 0, d.ts);
      media.save(s, m);
      // Only newly stored messages are returned, so live listeners never see duplicates.
      return existing ? undefined : { ...d, from_me: d.fromMe };
    },
    chats(s, q = '') {
      return db
        .prepare(
          `SELECT c.*, (SELECT body FROM messages m WHERE m.session_id=c.session_id AND m.jid=c.jid ORDER BY ts DESC LIMIT 1) AS preview FROM chats c WHERE session_id=? AND (COALESCE(name,'') LIKE ? OR jid LIKE ?) ORDER BY updated DESC LIMIT 200`,
        )
        .all(s, `%${q}%`, `%${q}%`);
    },
    messages(s, jid, before = Number.MAX_SAFE_INTEGER, limit = 100, beforeId = '') {
      return db
        .prepare(
          'SELECT * FROM messages WHERE session_id=? AND jid=? AND (ts<? OR (ts=? AND id<?)) ORDER BY ts DESC,id DESC LIMIT ?',
        )
        .all(s, jid, before, before, beforeId, limit)
        .reverse()
        .map(media.describe);
    },
    search(s, q, limit = 100) {
      return db
        .prepare('SELECT * FROM messages WHERE session_id=? AND body LIKE ? ORDER BY ts DESC LIMIT ?')
        .all(s, `%${q}%`, limit)
        .map(media.describe);
    },
    issueToken(s, name, scope, days = 90) {
      const token = 'wamcp_' + randomBytes(32).toString('base64url');
      const id = randomUUID();
      const created = new Date().toISOString();
      const expires = new Date(Date.now() + days * 86400000).toISOString();
      db.prepare(
        'INSERT INTO tokens(id,session_id,name,hash,scope,created,expires) VALUES(?,?,?,?,?,?,?)',
      ).run(id, s, name, hashToken(token), scope, created, expires);
      return { id, token, name, scope, expires };
    },
    tokens: (s) =>
      db
        .prepare(
          'SELECT id,name,scope,created,expires,last_used FROM tokens WHERE session_id=? ORDER BY created DESC',
        )
        .all(s),
    authenticate(s, token) {
      if (typeof token !== 'string' || token.length > 256) return null;
      const t = db
        .prepare('SELECT * FROM tokens WHERE session_id=? AND hash=? AND expires>?')
        .get(s, hashToken(token), new Date().toISOString());
      if (t) db.prepare('UPDATE tokens SET last_used=? WHERE id=?').run(new Date().toISOString(), t.id);
      return t || null;
    },
    revoke(s, id) {
      return db.prepare('DELETE FROM tokens WHERE session_id=? AND id=?').run(s, id);
    },
    eventPrincipal(s, id) {
      return (
        db
          .prepare('SELECT id,session_id,scope FROM tokens WHERE session_id=? AND id=? AND expires>?')
          .get(s, id, new Date().toISOString()) || null
      );
    },
    audit(s, t, action) {
      db.prepare('INSERT INTO audit(session_id,token_id,action,at) VALUES(?,?,?,?)').run(
        s,
        t,
        action,
        new Date().toISOString(),
      );
    },
    events: (s) =>
      db.prepare('SELECT action,at,token_id FROM audit WHERE session_id=? ORDER BY id DESC LIMIT 50').all(s),
    close() {
      db.close();
    },
  };
}
