const SELECT = `SELECT m.*, CASE m.sender_type WHEN 'user' THEN u.name WHEN 'contact' THEN ct.name
    WHEN 'agent_bot' THEN 'Assistente IA' END AS sender_name
  FROM conversation_messages m JOIN conversations c ON c.id=m.conversation_id JOIN contacts ct ON ct.id=c.contact_id
  LEFT JOIN users u ON m.sender_type='user' AND u.id=m.sender_id`;
const hydrate = (row) =>
  row
    ? { ...row, private: Boolean(row.private), content_attributes: JSON.parse(row.content_attributes) }
    : null;

/** Support messages (incoming, outgoing, activity, private notes) with WhatsApp id deduplication. */
export function messageStore(db) {
  const message = (id) => hydrate(db.prepare(`${SELECT} WHERE m.id=?`).get(id));
  return {
    message,
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
      return result.changes ? message(Number(result.lastInsertRowid)) : null;
    },
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
      return message(id);
    },
    /** Page of messages before a message id (cursor), oldest first. */
    messages: (conversationId, before = Number.MAX_SAFE_INTEGER, limit = 50) =>
      db
        .prepare(`${SELECT} WHERE m.conversation_id=? AND m.id<? ORDER BY m.id DESC LIMIT ?`)
        .all(conversationId, before, limit)
        .reverse()
        .map(hydrate),
  };
}
