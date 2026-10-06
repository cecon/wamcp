import { placeholders, updateFields } from './sql.mjs';

/** Labels, canned responses and per-agent notifications. */
export function catalogStore(db) {
  const label = (id) => db.prepare('SELECT * FROM labels WHERE id=?').get(id) || null;
  const NOTIFICATION = `SELECT n.*, c.display_id, ct.name AS contact_name, u.name AS actor_name FROM notifications n
    LEFT JOIN conversations c ON c.id=n.conversation_id LEFT JOIN contacts ct ON ct.id=c.contact_id
    LEFT JOIN users u ON u.id=n.actor_user_id`;
  const notification = (id) => db.prepare(`${NOTIFICATION} WHERE n.id=?`).get(id) || null;
  const canned = (id) => db.prepare('SELECT * FROM canned_responses WHERE id=?').get(id) || null;
  return {
    labels: () => db.prepare('SELECT * FROM labels ORDER BY title').all(),
    label,
    labelByTitle: (title, exceptId = 0) =>
      db.prepare('SELECT * FROM labels WHERE title=? AND id<>?').get(title, exceptId) || null,
    labelsByTitles: (titles) =>
      db.prepare(`SELECT * FROM labels WHERE title IN (${placeholders(titles)})`).all(...titles),
    createLabel({ title, description, color, show_on_sidebar = true }) {
      const { lastInsertRowid } = db
        .prepare('INSERT INTO labels(title,description,color,show_on_sidebar) VALUES(?,?,?,?)')
        .run(title, description ?? null, color || '#1f93ff', Number(show_on_sidebar));
      return label(Number(lastInsertRowid));
    },
    updateLabel(id, fields) {
      updateFields(db, 'labels', id, fields, ['title', 'description', 'color', 'show_on_sidebar']);
      return label(id);
    },
    deleteLabel: (id) => db.prepare('DELETE FROM labels WHERE id=?').run(id),

    cannedResponses: (q = '') =>
      db
        .prepare(
          'SELECT * FROM canned_responses WHERE short_code LIKE ? OR content LIKE ? ORDER BY short_code LIMIT 200',
        )
        .all(`%${q}%`, `%${q}%`),
    cannedResponse: canned,
    cannedByCode: (code, exceptId = 0) =>
      db.prepare('SELECT * FROM canned_responses WHERE short_code=? AND id<>?').get(code, exceptId) || null,
    createCanned({ short_code, content }) {
      const { lastInsertRowid } = db
        .prepare('INSERT INTO canned_responses(short_code,content) VALUES(?,?)')
        .run(short_code, content);
      return canned(Number(lastInsertRowid));
    },
    updateCanned(id, fields) {
      updateFields(db, 'canned_responses', id, fields, ['short_code', 'content']);
      return canned(id);
    },
    deleteCanned: (id) => db.prepare('DELETE FROM canned_responses WHERE id=?').run(id),

    createNotification({ userId, type, conversationId, actorUserId, createdAt }) {
      const { lastInsertRowid } = db
        .prepare(
          'INSERT INTO notifications(user_id,notification_type,conversation_id,actor_user_id,created_at) VALUES(?,?,?,?,?)',
        )
        .run(userId, type, conversationId ?? null, actorUserId ?? null, createdAt);
      return notification(Number(lastInsertRowid));
    },
    notification,
    notifications: (userId, limit = 50) =>
      db.prepare(`${NOTIFICATION} WHERE n.user_id=? ORDER BY n.id DESC LIMIT ?`).all(userId, limit),
    unreadNotifications: (userId) =>
      db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id=? AND read_at IS NULL').get(userId).n,
    readNotification: (userId, id, at) =>
      db
        .prepare('UPDATE notifications SET read_at=COALESCE(read_at,?) WHERE user_id=? AND id=?')
        .run(at, userId, id).changes,
    readAllNotifications: (userId, at) =>
      db.prepare('UPDATE notifications SET read_at=? WHERE user_id=? AND read_at IS NULL').run(at, userId),
  };
}
