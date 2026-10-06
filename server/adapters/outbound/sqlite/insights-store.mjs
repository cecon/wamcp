/** Working hours, CSAT responses and reporting events/aggregates. */
export function insightsStore(db) {
  const range = 'created_at>=? AND created_at<?';
  const inboxFilter = (inboxId) => (inboxId ? ' AND inbox_id=?' : '');
  const args = (since, until, inboxId) => (inboxId ? [since, until, inboxId] : [since, until]);
  const avg = (name, since, until, inboxId) =>
    db
      .prepare(
        `SELECT COUNT(*) AS count, AVG(value) AS average FROM reporting_events WHERE name=? AND ${range}${inboxFilter(inboxId)}`,
      )
      .get(name, ...args(since, until, inboxId));
  return {
    workingHours: (inboxId) =>
      db.prepare('SELECT * FROM working_hours WHERE inbox_id=? ORDER BY day_of_week').all(inboxId),
    setWorkingHours(inboxId, days) {
      db.prepare('DELETE FROM working_hours WHERE inbox_id=?').run(inboxId);
      const insert = db.prepare(
        'INSERT INTO working_hours(inbox_id,day_of_week,closed_all_day,open_minutes,close_minutes) VALUES(?,?,?,?,?)',
      );
      for (const d of days)
        insert.run(
          inboxId,
          d.day_of_week,
          Number(Boolean(d.closed_all_day)),
          d.open_minutes,
          d.close_minutes,
        );
    },

    createCsat({ conversationId, contactId, assigneeId, inboxId, rating, feedback, createdAt }) {
      const { id } = db
        .prepare(
          `INSERT INTO csat_responses(conversation_id,contact_id,assignee_id,inbox_id,rating,feedback,created_at)
           VALUES(?,?,?,?,?,?,?) ON CONFLICT(conversation_id) DO UPDATE SET rating=excluded.rating,
           feedback=excluded.feedback,created_at=excluded.created_at RETURNING id`,
        )
        .get(conversationId, contactId, assigneeId ?? null, inboxId, rating, feedback ?? null, createdAt);
      return db.prepare('SELECT * FROM csat_responses WHERE id=?').get(id);
    },
    csatResponses: (since, until, inboxId) =>
      db
        .prepare(
          `SELECT r.*, c.display_id, ct.name AS contact_name, u.name AS assignee_name FROM csat_responses r
           JOIN conversations c ON c.id=r.conversation_id JOIN contacts ct ON ct.id=r.contact_id
           LEFT JOIN users u ON u.id=r.assignee_id WHERE r.${range}${inboxId ? ' AND r.inbox_id=?' : ''}
           ORDER BY r.created_at DESC LIMIT 200`,
        )
        .all(...args(since, until, inboxId)),

    /** first_response is recorded at most once per conversation (unique partial index). */
    recordEvent: ({ name, value, userId, inboxId, conversationId, createdAt }) =>
      db
        .prepare(
          'INSERT OR IGNORE INTO reporting_events(name,value,user_id,inbox_id,conversation_id,created_at) VALUES(?,?,?,?,?,?)',
        )
        .run(name, value, userId ?? null, inboxId, conversationId, createdAt),
    firstIncomingAt: (conversationId) =>
      db
        .prepare(
          "SELECT MIN(created_at) AS at FROM conversation_messages WHERE conversation_id=? AND message_type='incoming'",
        )
        .get(conversationId).at,
    summary(since, until, inboxId) {
      const count = (sql) => db.prepare(sql).get(...args(since, until, inboxId)).n;
      const csat = db
        .prepare(
          `SELECT COUNT(*) AS count, AVG(rating) AS average FROM csat_responses WHERE ${range}${inboxFilter(inboxId)}`,
        )
        .get(...args(since, until, inboxId));
      return {
        conversations: count(
          `SELECT COUNT(*) AS n FROM conversations WHERE CAST(strftime('%s',created) AS INTEGER)>=? AND CAST(strftime('%s',created) AS INTEGER)<?${inboxFilter(inboxId)}`,
        ),
        incoming_messages: count(
          `SELECT COUNT(*) AS n FROM conversation_messages WHERE message_type='incoming' AND ${range}${inboxFilter(inboxId)}`,
        ),
        outgoing_messages: count(
          `SELECT COUNT(*) AS n FROM conversation_messages WHERE message_type='outgoing' AND private=0 AND ${range}${inboxFilter(inboxId)}`,
        ),
        resolutions: avg('conversation_resolved', since, until, inboxId),
        first_response: avg('first_response', since, until, inboxId),
        csat,
      };
    },
    agentReport: (since, until, inboxId) =>
      db
        .prepare(
          `SELECT u.id, u.name,
             SUM(CASE WHEN e.name='conversation_resolved' THEN 1 ELSE 0 END) AS resolved,
             AVG(CASE WHEN e.name='first_response' THEN e.value END) AS avg_first_response,
             AVG(CASE WHEN e.name='conversation_resolved' THEN e.value END) AS avg_resolution,
             (SELECT AVG(r.rating) FROM csat_responses r WHERE r.assignee_id=u.id AND r.${range}${inboxId ? ' AND r.inbox_id=?' : ''}) AS csat
           FROM users u LEFT JOIN reporting_events e ON e.user_id=u.id AND e.${range}${inboxId ? ' AND e.inbox_id=?' : ''}
           GROUP BY u.id ORDER BY resolved DESC, u.name`,
        )
        .all(...args(since, until, inboxId), ...args(since, until, inboxId)),
  };
}
