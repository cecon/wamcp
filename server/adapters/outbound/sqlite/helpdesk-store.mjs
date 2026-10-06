const iso = () => new Date().toISOString();
const PAGE = 25;

const CONVERSATION_SELECT = `SELECT c.*, ct.name AS contact_name, ct.phone_number AS contact_phone, ci.source_id AS contact_jid,
  i.name AS inbox_name, u.name AS assignee_name, t.name AS team_name,
  (SELECT content FROM conversation_messages m WHERE m.conversation_id=c.id AND m.message_type<>'activity'
     ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS last_message,
  (SELECT COUNT(*) FROM conversation_messages m WHERE m.conversation_id=c.id AND m.message_type='incoming'
     AND m.created_at>COALESCE(c.agent_last_seen_at,0)) AS unread_count
  FROM conversations c JOIN contacts ct ON ct.id=c.contact_id JOIN contact_inboxes ci ON ci.id=c.contact_inbox_id
  JOIN inboxes i ON i.id=c.inbox_id LEFT JOIN users u ON u.id=c.assignee_id LEFT JOIN teams t ON t.id=c.team_id`;

/** Inboxes, contacts, conversations and support messages. */
export function helpdeskStore(db) {
  const inbox = (id) =>
    db
      .prepare(
        'SELECT i.*, w.session_id, w.ignore_groups FROM inboxes i JOIN channel_whatsapp w ON w.id=i.channel_id WHERE i.id=?',
      )
      .get(id) || null;
  const conversationById = (id) => db.prepare(`${CONVERSATION_SELECT} WHERE c.id=?`).get(id) || null;
  const set = (table, id, fields, allowed) => {
    const keys = Object.keys(fields).filter((k) => allowed.includes(k) && fields[k] !== undefined);
    if (keys.length)
      db.prepare(`UPDATE ${table} SET ${keys.map((k) => `${k}=?`).join(',')} WHERE id=?`).run(
        ...keys.map((k) => (typeof fields[k] === 'boolean' ? Number(fields[k]) : fields[k])),
        id,
      );
  };
  /** Builds WHERE clauses shared by the list and the tab counters. */
  function scope({ status, inboxId, teamId, q, visibleInboxIds }) {
    const where = [],
      args = [];
    const add = (clause, ...values) => {
      where.push(clause);
      args.push(...values);
    };
    if (status && status !== 'all') add('c.status=?', status);
    if (inboxId) add('c.inbox_id=?', inboxId);
    if (teamId) add('c.team_id=?', teamId);
    if (visibleInboxIds)
      add(`c.inbox_id IN (${visibleInboxIds.map(() => '?').join(',') || 'NULL'})`, ...visibleInboxIds);
    if (q) add('(ct.name LIKE ? OR ct.phone_number LIKE ?)', `%${q}%`, `%${q}%`);
    return { where, args };
  }
  const ASSIGNEE = {
    me: 'c.assignee_id=?',
    unassigned: 'c.assignee_id IS NULL',
    assigned: 'c.assignee_id IS NOT NULL',
  };
  return {
    transaction(work) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const result = work();
        db.exec('COMMIT');
        return result;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
    inbox,
    inboxes: (ids = null) =>
      db
        .prepare(
          `SELECT i.*, w.session_id, w.ignore_groups, s.status AS session_status, s.phone FROM inboxes i
           JOIN channel_whatsapp w ON w.id=i.channel_id JOIN sessions s ON s.id=w.session_id
           ${ids ? `WHERE i.id IN (${ids.map(() => '?').join(',') || 'NULL'})` : ''} ORDER BY i.name`,
        )
        .all(...(ids || [])),
    /** Every Baileys session is a WhatsApp channel; the inbox is created on first use. */
    inboxForSession(sessionId) {
      const found = db
        .prepare(
          'SELECT i.id FROM inboxes i JOIN channel_whatsapp w ON w.id=i.channel_id WHERE w.session_id=?',
        )
        .get(sessionId);
      if (found) return inbox(found.id);
      const session = db.prepare('SELECT name FROM sessions WHERE id=?').get(sessionId);
      if (!session) return null;
      const channel = db.prepare('INSERT INTO channel_whatsapp(session_id) VALUES(?)').run(sessionId);
      const created = db
        .prepare("INSERT INTO inboxes(name,channel_type,channel_id,created) VALUES(?,'whatsapp',?,?)")
        .run(session.name, Number(channel.lastInsertRowid), iso());
      return inbox(Number(created.lastInsertRowid));
    },
    /** Creates the missing inbox for every WhatsApp session (new sessions get one automatically). */
    syncInboxes() {
      for (const { id } of db
        .prepare('SELECT id FROM sessions WHERE id NOT IN (SELECT session_id FROM channel_whatsapp)')
        .all())
        this.inboxForSession(id);
    },
    updateInbox(id, fields) {
      set('inboxes', id, fields, [
        'name',
        'enable_auto_assignment',
        'greeting_enabled',
        'greeting_message',
        'lock_to_single_conversation',
        'timezone',
      ]);
      const current = inbox(id);
      if (fields.ignore_groups !== undefined)
        db.prepare('UPDATE channel_whatsapp SET ignore_groups=? WHERE id=?').run(
          Number(fields.ignore_groups),
          current.channel_id,
        );
      return inbox(id);
    },

    contactInbox: (inboxId, sourceId) =>
      db.prepare('SELECT * FROM contact_inboxes WHERE inbox_id=? AND source_id=?').get(inboxId, sourceId) ||
      null,
    contactByPhone: (phone) => db.prepare('SELECT * FROM contacts WHERE phone_number=?').get(phone) || null,
    createContact({ name, phone }) {
      const { lastInsertRowid } = db
        .prepare('INSERT INTO contacts(name,phone_number,created) VALUES(?,?,?)')
        .run(name ?? null, phone ?? null, iso());
      return db.prepare('SELECT * FROM contacts WHERE id=?').get(Number(lastInsertRowid));
    },
    createContactInbox(contactId, inboxId, sourceId) {
      const { lastInsertRowid } = db
        .prepare('INSERT INTO contact_inboxes(contact_id,inbox_id,source_id) VALUES(?,?,?)')
        .run(contactId, inboxId, sourceId);
      return db.prepare('SELECT * FROM contact_inboxes WHERE id=?').get(Number(lastInsertRowid));
    },
    contact: (id) => db.prepare('SELECT * FROM contacts WHERE id=?').get(id) || null,
    contacts: (q = '', page = 1) =>
      db
        .prepare(
          "SELECT * FROM contacts WHERE COALESCE(name,'') LIKE ? OR COALESCE(phone_number,'') LIKE ? OR COALESCE(email,'') LIKE ? ORDER BY last_activity_at DESC NULLS LAST, id DESC LIMIT ? OFFSET ?",
        )
        .all(`%${q}%`, `%${q}%`, `%${q}%`, PAGE, (page - 1) * PAGE),
    updateContact(id, fields) {
      set('contacts', id, fields, [
        'name',
        'email',
        'phone_number',
        'identifier',
        'blocked',
        'custom_attributes',
        'last_activity_at',
      ]);
      return db.prepare('SELECT * FROM contacts WHERE id=?').get(id);
    },
    contactConversations: (contactId, visibleInboxIds) => {
      const { where, args } = scope({ visibleInboxIds });
      return db
        .prepare(
          `${CONVERSATION_SELECT} WHERE c.contact_id=? ${where.length ? 'AND ' + where.join(' AND ') : ''} ORDER BY c.last_activity_at DESC`,
        )
        .all(contactId, ...args);
    },

    latestConversation: (contactInboxId) =>
      db
        .prepare('SELECT * FROM conversations WHERE contact_inbox_id=? ORDER BY id DESC LIMIT 1')
        .get(contactInboxId) || null,
    createConversation({ inboxId, contactId, contactInboxId, status, ts }) {
      const { next } = db
        .prepare('SELECT COALESCE(MAX(display_id),0)+1 AS next FROM conversations WHERE account_id=1')
        .get();
      const { lastInsertRowid } = db
        .prepare(
          'INSERT INTO conversations(display_id,inbox_id,contact_id,contact_inbox_id,status,waiting_since,last_activity_at,created) VALUES(?,?,?,?,?,?,?,?)',
        )
        .run(next, inboxId, contactId, contactInboxId, status, ts, ts, iso());
      return conversationById(Number(lastInsertRowid));
    },
    conversationById,
    conversation: (displayId) =>
      db.prepare(`${CONVERSATION_SELECT} WHERE c.display_id=?`).get(displayId) || null,
    updateConversation(id, fields) {
      set('conversations', id, fields, [
        'status',
        'priority',
        'assignee_id',
        'team_id',
        'snoozed_until',
        'waiting_since',
        'first_reply_at',
        'agent_last_seen_at',
        'last_activity_at',
      ]);
      return conversationById(id);
    },
    conversations(filters) {
      const { where, args } = scope(filters);
      const type = filters.assigneeType || 'all';
      if (ASSIGNEE[type]) where.push(ASSIGNEE[type]);
      if (type === 'me') args.push(filters.userId);
      const page = filters.page || 1;
      return db
        .prepare(
          `${CONVERSATION_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY c.last_activity_at DESC, c.id DESC LIMIT ? OFFSET ?`,
        )
        .all(...args, PAGE, (page - 1) * PAGE);
    },
    conversationCounts(filters) {
      const { where, args } = scope(filters);
      const base = `SELECT COUNT(*) AS n FROM conversations c JOIN contacts ct ON ct.id=c.contact_id ${where.length ? 'WHERE ' + where.join(' AND ') : 'WHERE 1=1'}`;
      return {
        mine: db.prepare(`${base} AND c.assignee_id=?`).get(...args, filters.userId).n,
        unassigned: db.prepare(`${base} AND c.assignee_id IS NULL`).get(...args).n,
        all: db.prepare(base).get(...args).n,
      };
    },
    dueSnoozed: (now) =>
      db.prepare("SELECT id FROM conversations WHERE status='snoozed' AND snoozed_until<=?").all(now),

    /** Returns the stored row, or null when the WhatsApp message id was already recorded. */
    insertMessage(m) {
      const result = db
        .prepare(
          `INSERT INTO conversation_messages(conversation_id,inbox_id,message_type,content,content_type,private,status,
             sender_type,sender_id,source_id,wa_jid,content_attributes,created_at)
           VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(inbox_id,source_id) WHERE source_id IS NOT NULL DO NOTHING`,
        )
        .run(
          m.conversationId,
          m.inboxId,
          m.messageType,
          m.content ?? null,
          m.contentType || 'text',
          Number(Boolean(m.private)),
          m.status || 'sent',
          m.senderType ?? null,
          m.senderId ?? null,
          m.sourceId ?? null,
          m.waJid ?? null,
          JSON.stringify(m.contentAttributes || {}),
          m.createdAt,
        );
      return result.changes ? this.message(Number(result.lastInsertRowid)) : null;
    },
    message: (id) =>
      db
        .prepare(
          `SELECT m.*, CASE m.sender_type WHEN 'user' THEN u.name WHEN 'contact' THEN ct.name END AS sender_name
           FROM conversation_messages m JOIN conversations c ON c.id=m.conversation_id JOIN contacts ct ON ct.id=c.contact_id
           LEFT JOIN users u ON m.sender_type='user' AND u.id=m.sender_id WHERE m.id=?`,
        )
        .get(id) || null,
    messageBySource: (inboxId, sourceId) =>
      db
        .prepare('SELECT * FROM conversation_messages WHERE inbox_id=? AND source_id=?')
        .get(inboxId, sourceId) || null,
    updateMessage(id, { status, contentAttributes }) {
      if (status) db.prepare('UPDATE conversation_messages SET status=? WHERE id=?').run(status, id);
      if (contentAttributes)
        db.prepare('UPDATE conversation_messages SET content_attributes=? WHERE id=?').run(
          JSON.stringify(contentAttributes),
          id,
        );
      return this.message(id);
    },
    messages: (conversationId, before = Number.MAX_SAFE_INTEGER, limit = 50) =>
      db
        .prepare(
          `SELECT m.*, CASE m.sender_type WHEN 'user' THEN u.name WHEN 'contact' THEN ct.name END AS sender_name
           FROM conversation_messages m JOIN conversations c ON c.id=m.conversation_id JOIN contacts ct ON ct.id=c.contact_id
           LEFT JOIN users u ON m.sender_type='user' AND u.id=m.sender_id
           WHERE m.conversation_id=? AND m.id<? ORDER BY m.id DESC LIMIT ?`,
        )
        .all(conversationId, before, limit)
        .reverse(),
    addParticipant: (conversationId, userId) =>
      db
        .prepare('INSERT OR IGNORE INTO conversation_participants(conversation_id,user_id) VALUES(?,?)')
        .run(conversationId, userId),
  };
}
