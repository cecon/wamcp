import { iso, PAGE, placeholders, updateFields } from './sql.mjs';

const SELECT = `SELECT c.*, ct.name AS contact_name, ct.phone_number AS contact_phone, ci.source_id AS contact_jid,
  i.name AS inbox_name, i.agent_bot_enabled, u.name AS assignee_name, t.name AS team_name,
  (SELECT json_group_array(l.title) FROM conversation_labels cl JOIN labels l ON l.id=cl.label_id
     WHERE cl.conversation_id=c.id) AS labels,
  (SELECT content FROM conversation_messages m WHERE m.conversation_id=c.id AND m.message_type<>'activity'
     ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS last_message,
  (SELECT COUNT(*) FROM conversation_messages m WHERE m.conversation_id=c.id AND m.message_type='incoming'
     AND m.created_at>COALESCE(c.agent_last_seen_at,0)) AS unread_count
  FROM conversations c JOIN contacts ct ON ct.id=c.contact_id JOIN contact_inboxes ci ON ci.id=c.contact_inbox_id
  JOIN inboxes i ON i.id=c.inbox_id LEFT JOIN users u ON u.id=c.assignee_id LEFT JOIN teams t ON t.id=c.team_id`;
const FIELDS = [
  'status',
  'priority',
  'assignee_id',
  'team_id',
  'snoozed_until',
  'waiting_since',
  'first_reply_at',
  'agent_last_seen_at',
  'last_activity_at',
  'csat_requested_at',
];
const ASSIGNEE = {
  me: 'c.assignee_id=?',
  unassigned: 'c.assignee_id IS NULL',
  assigned: 'c.assignee_id IS NOT NULL',
};
const hydrate = (row) => (row ? { ...row, labels: JSON.parse(row.labels || '[]').sort() } : null);

/** Builds WHERE clauses shared by the list and the tab counters. */
function scope({ status, inboxId, teamId, label, q, visibleInboxIds }) {
  const where = [],
    args = [];
  const add = (clause, ...values) => {
    where.push(clause);
    args.push(...values);
  };
  if (status && status !== 'all') add('c.status=?', status);
  if (inboxId) add('c.inbox_id=?', inboxId);
  if (teamId) add('c.team_id=?', teamId);
  if (label)
    add(
      'EXISTS(SELECT 1 FROM conversation_labels cl JOIN labels l ON l.id=cl.label_id WHERE cl.conversation_id=c.id AND l.title=?)',
      label,
    );
  if (visibleInboxIds) add(`c.inbox_id IN (${placeholders(visibleInboxIds)})`, ...visibleInboxIds);
  if (q) add('(ct.name LIKE ? OR ct.phone_number LIKE ?)', `%${q}%`, `%${q}%`);
  return { where, args };
}
const clause = (where, joiner = 'WHERE') => (where.length ? `${joiner} ${where.join(' AND ')}` : '');

/** Conversations: lifecycle fields, list filters, tab counters and labels. */
export function conversationStore(db) {
  const conversationById = (id) => hydrate(db.prepare(`${SELECT} WHERE c.id=?`).get(id));
  return {
    conversationById,
    conversation: (displayId) => hydrate(db.prepare(`${SELECT} WHERE c.display_id=?`).get(displayId)),
    latestConversation: (contactInboxId) =>
      db
        .prepare('SELECT * FROM conversations WHERE contact_inbox_id=? ORDER BY id DESC LIMIT 1')
        .get(contactInboxId) || null,
    /** display_id is sequential per account; callers run inside a write transaction. */
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
    updateConversation(id, fields) {
      updateFields(db, 'conversations', id, fields, FIELDS);
      return conversationById(id);
    },
    conversations(filters) {
      const { where, args } = scope(filters);
      const type = filters.assigneeType || 'all';
      if (ASSIGNEE[type]) where.push(ASSIGNEE[type]);
      if (type === 'me') args.push(filters.userId);
      const page = filters.page || 1;
      return db
        .prepare(`${SELECT} ${clause(where)} ORDER BY c.last_activity_at DESC, c.id DESC LIMIT ? OFFSET ?`)
        .all(...args, PAGE, (page - 1) * PAGE)
        .map(hydrate);
    },
    conversationCounts(filters) {
      const { where, args } = scope(filters);
      const base = `SELECT COUNT(*) AS n FROM conversations c JOIN contacts ct ON ct.id=c.contact_id WHERE 1=1 ${clause(where, 'AND')}`;
      return {
        mine: db.prepare(`${base} AND c.assignee_id=?`).get(...args, filters.userId).n,
        unassigned: db.prepare(`${base} AND c.assignee_id IS NULL`).get(...args).n,
        all: db.prepare(base).get(...args).n,
      };
    },
    contactConversations(contactId, visibleInboxIds) {
      const { where, args } = scope({ visibleInboxIds });
      return db
        .prepare(`${SELECT} WHERE c.contact_id=? ${clause(where, 'AND')} ORDER BY c.last_activity_at DESC`)
        .all(contactId, ...args)
        .map(hydrate);
    },
    dueSnoozed: (now) =>
      db.prepare("SELECT id FROM conversations WHERE status='snoozed' AND snoozed_until<=?").all(now),
    addParticipant: (conversationId, userId) =>
      db
        .prepare('INSERT OR IGNORE INTO conversation_participants(conversation_id,user_id) VALUES(?,?)')
        .run(conversationId, userId),
    participantIds: (conversationId) =>
      db
        .prepare('SELECT user_id FROM conversation_participants WHERE conversation_id=?')
        .all(conversationId)
        .map((r) => r.user_id),
    /** Replaces the conversation's labels with the given label ids. */
    setConversationLabels(conversationId, labelIds) {
      db.prepare('DELETE FROM conversation_labels WHERE conversation_id=?').run(conversationId);
      const insert = db.prepare('INSERT INTO conversation_labels(conversation_id,label_id) VALUES(?,?)');
      for (const id of labelIds) insert.run(conversationId, id);
      return conversationById(conversationId);
    },
  };
}
