import { randomBytes, randomUUID } from 'node:crypto';
import { hashToken } from './store.mjs';
import { iso, updateFields } from './sql.mjs';

const USER_COLUMNS = 'id,account_id,email,name,display_name,role,availability,active,created,last_login';

/** Users, web sessions, API tokens, teams and inbox membership. */
export function usersStore(db) {
  const user = (id) => db.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE id=?`).get(id) || null;
  const editable = ['name', 'display_name', 'role', 'availability', 'active', 'password_hash'];
  const update = (table, id, fields, allowed) => updateFields(db, table, id, fields, allowed);
  return {
    countUsers: () => db.prepare('SELECT COUNT(*) AS n FROM users').get().n,
    user,
    users: () => db.prepare(`SELECT ${USER_COLUMNS} FROM users ORDER BY name COLLATE NOCASE`).all(),
    credentials: (email) =>
      db.prepare('SELECT id,password_hash,active FROM users WHERE email=?').get(email) || null,
    passwordHash: (id) => db.prepare('SELECT password_hash FROM users WHERE id=?').get(id)?.password_hash,
    createUser({ name, email, role, passwordHash }) {
      const { lastInsertRowid } = db
        .prepare('INSERT INTO users(email,name,password_hash,role,created) VALUES(?,?,?,?,?)')
        .run(email, name, passwordHash, role, iso());
      return user(Number(lastInsertRowid));
    },
    emailTaken: (email, exceptId = 0) =>
      Boolean(db.prepare('SELECT 1 FROM users WHERE email=? AND id<>?').get(email, exceptId)),
    updateUser(id, fields) {
      update('users', id, fields, editable);
      return user(id);
    },
    deleteUser: (id) => db.prepare('DELETE FROM users WHERE id=?').run(id),
    countAdmins: () =>
      db.prepare("SELECT COUNT(*) AS n FROM users WHERE role='administrator' AND active=1").get().n,

    createWebSession(userId, ttlMs, userAgent) {
      const cookie = randomBytes(32).toString('base64url'),
        csrf = randomBytes(24).toString('base64url');
      db.prepare(
        'INSERT INTO user_sessions(id,user_id,csrf,created,expires,user_agent) VALUES(?,?,?,?,?,?)',
      ).run(
        hashToken(cookie),
        userId,
        csrf,
        iso(),
        iso(Date.now() + ttlMs),
        userAgent?.slice(0, 200) || null,
      );
      db.prepare('UPDATE users SET last_login=? WHERE id=?').run(iso(), userId);
      return { cookie, csrf };
    },
    webSession(cookie) {
      if (typeof cookie !== 'string' || cookie.length > 128) return null;
      const row = db
        .prepare('SELECT id,user_id,csrf FROM user_sessions WHERE id=? AND expires>?')
        .get(hashToken(cookie), iso());
      if (row) db.prepare('UPDATE user_sessions SET last_seen=? WHERE id=?').run(iso(), row.id);
      return row || null;
    },
    deleteWebSession: (cookie) => db.prepare('DELETE FROM user_sessions WHERE id=?').run(hashToken(cookie)),
    deleteUserSessions: (userId) => db.prepare('DELETE FROM user_sessions WHERE user_id=?').run(userId),

    issueApiToken(ownerType, ownerId) {
      const token = 'wahd_' + randomBytes(32).toString('base64url');
      db.prepare('DELETE FROM api_access_tokens WHERE owner_type=? AND owner_id=?').run(ownerType, ownerId);
      db.prepare('INSERT INTO api_access_tokens(id,owner_type,owner_id,hash,created) VALUES(?,?,?,?,?)').run(
        randomUUID(),
        ownerType,
        ownerId,
        hashToken(token),
        iso(),
      );
      return token;
    },
    apiTokenOwner(token) {
      if (typeof token !== 'string' || token.length > 256) return null;
      const row = db.prepare('SELECT * FROM api_access_tokens WHERE hash=?').get(hashToken(token));
      if (row) db.prepare('UPDATE api_access_tokens SET last_used=? WHERE id=?').run(iso(), row.id);
      return row || null;
    },

    teams: () =>
      db
        .prepare(
          'SELECT t.*,(SELECT COUNT(*) FROM team_members m WHERE m.team_id=t.id) AS member_count FROM teams t ORDER BY name',
        )
        .all(),
    team: (id) => db.prepare('SELECT * FROM teams WHERE id=?').get(id) || null,
    teamByName: (name, exceptId = 0) =>
      db.prepare('SELECT * FROM teams WHERE name=? AND id<>?').get(name, exceptId) || null,
    createTeam({ name, description, allow_auto_assign = true }) {
      const { lastInsertRowid } = db
        .prepare('INSERT INTO teams(name,description,allow_auto_assign) VALUES(?,?,?)')
        .run(name, description ?? null, Number(allow_auto_assign));
      return db.prepare('SELECT * FROM teams WHERE id=?').get(Number(lastInsertRowid));
    },
    updateTeam(id, fields) {
      update('teams', id, fields, ['name', 'description', 'allow_auto_assign']);
      return db.prepare('SELECT * FROM teams WHERE id=?').get(id);
    },
    deleteTeam: (id) => db.prepare('DELETE FROM teams WHERE id=?').run(id),
    teamMembers: (teamId) =>
      db
        .prepare(
          `SELECT ${USER_COLUMNS.replace(/(\w+)/g, 'u.$1')} FROM users u JOIN team_members m ON m.user_id=u.id WHERE m.team_id=? ORDER BY u.name`,
        )
        .all(teamId),
    addTeamMembers(teamId, userIds) {
      const insert = db.prepare('INSERT OR IGNORE INTO team_members(team_id,user_id) VALUES(?,?)');
      for (const id of userIds) insert.run(teamId, id);
    },
    removeTeamMembers(teamId, userIds) {
      const remove = db.prepare('DELETE FROM team_members WHERE team_id=? AND user_id=?');
      for (const id of userIds) remove.run(teamId, id);
    },

    memberInboxIds: (userId) =>
      db
        .prepare('SELECT inbox_id FROM inbox_members WHERE user_id=?')
        .all(userId)
        .map((r) => r.inbox_id),
    inboxMembers: (inboxId) =>
      db
        .prepare(
          `SELECT ${USER_COLUMNS.replace(/(\w+)/g, 'u.$1')} FROM users u JOIN inbox_members m ON m.user_id=u.id WHERE m.inbox_id=? ORDER BY u.name`,
        )
        .all(inboxId),
    addInboxMembers(inboxId, userIds) {
      const insert = db.prepare('INSERT OR IGNORE INTO inbox_members(inbox_id,user_id) VALUES(?,?)');
      for (const id of userIds) insert.run(inboxId, id);
    },
    removeInboxMembers(inboxId, userIds) {
      const remove = db.prepare('DELETE FROM inbox_members WHERE inbox_id=? AND user_id=?');
      for (const id of userIds) remove.run(inboxId, id);
    },
    /** Online, active members of the inbox (optionally restricted to a team) eligible for auto-assignment. */
    assignableIds(inboxId, teamId = null) {
      const sql = `SELECT u.id FROM users u JOIN inbox_members m ON m.user_id=u.id
        WHERE m.inbox_id=? AND u.active=1 AND u.availability='online'
        ${teamId ? 'AND u.id IN (SELECT user_id FROM team_members WHERE team_id=?)' : ''}`;
      return db
        .prepare(sql)
        .all(...(teamId ? [inboxId, teamId] : [inboxId]))
        .map((r) => r.id);
    },
    assignmentCursor: (inboxId) =>
      db.prepare('SELECT last_user_id FROM inbox_assignment_cursor WHERE inbox_id=?').get(inboxId)
        ?.last_user_id ?? null,
    setAssignmentCursor: (inboxId, userId) =>
      db
        .prepare(
          'INSERT INTO inbox_assignment_cursor(inbox_id,last_user_id) VALUES(?,?) ON CONFLICT(inbox_id) DO UPDATE SET last_user_id=excluded.last_user_id',
        )
        .run(inboxId, userId),
  };
}
