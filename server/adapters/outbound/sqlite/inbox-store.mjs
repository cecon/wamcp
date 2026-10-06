import { iso, placeholders, updateFields } from './sql.mjs';

const INBOX_FIELDS = [
  'name',
  'enable_auto_assignment',
  'greeting_enabled',
  'greeting_message',
  'lock_to_single_conversation',
  'timezone',
  'agent_bot_enabled',
];

/** Inboxes backed by WhatsApp sessions (one Baileys session = one channel). */
export function inboxStore(db) {
  const inbox = (id) =>
    db
      .prepare(
        `SELECT i.*, w.session_id, w.ignore_groups, s.status AS session_status, s.phone FROM inboxes i
         JOIN channel_whatsapp w ON w.id=i.channel_id JOIN sessions s ON s.id=w.session_id WHERE i.id=?`,
      )
      .get(id) || null;
  function inboxForSession(sessionId) {
    const found = db
      .prepare('SELECT i.id FROM inboxes i JOIN channel_whatsapp w ON w.id=i.channel_id WHERE w.session_id=?')
      .get(sessionId);
    if (found) return inbox(found.id);
    const session = db.prepare('SELECT name FROM sessions WHERE id=?').get(sessionId);
    if (!session) return null;
    const channel = db.prepare('INSERT INTO channel_whatsapp(session_id) VALUES(?)').run(sessionId);
    const created = db
      .prepare("INSERT INTO inboxes(name,channel_type,channel_id,created) VALUES(?,'whatsapp',?,?)")
      .run(session.name, Number(channel.lastInsertRowid), iso());
    return inbox(Number(created.lastInsertRowid));
  }
  return {
    inbox,
    inboxes: (ids = null) =>
      db
        .prepare(
          `SELECT i.*, w.session_id, w.ignore_groups, s.status AS session_status, s.phone FROM inboxes i
           JOIN channel_whatsapp w ON w.id=i.channel_id JOIN sessions s ON s.id=w.session_id
           ${ids ? `WHERE i.id IN (${placeholders(ids)})` : ''} ORDER BY i.name`,
        )
        .all(...(ids || [])),
    /** Every Baileys session is a WhatsApp channel; the inbox is created on first use. */
    inboxForSession,
    /** Creates the missing inbox for every WhatsApp session. */
    syncInboxes() {
      for (const { id } of db
        .prepare('SELECT id FROM sessions WHERE id NOT IN (SELECT session_id FROM channel_whatsapp)')
        .all())
        inboxForSession(id);
    },
    updateInbox(id, fields) {
      updateFields(db, 'inboxes', id, fields, INBOX_FIELDS);
      if (fields.ignore_groups !== undefined)
        db.prepare('UPDATE channel_whatsapp SET ignore_groups=? WHERE id=?').run(
          Number(fields.ignore_groups),
          inbox(id).channel_id,
        );
      return inbox(id);
    },
  };
}
