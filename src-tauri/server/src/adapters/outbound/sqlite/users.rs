use super::db::{flag, int, iso, now_ms, opt_int, opt_text, text, SqliteStore, PLAIN};
use crate::application::crypto::{random_secret, sha256_hex};
use crate::application::ports::UsersRepo;
use crate::domain::error::{Error, Result};
use crate::domain::model::{Credentials, Team, TeamFields, TokenOwner, User, UserChanges, WebSession};
use rusqlite::types::Value as Sql;

const USER_COLUMNS: &str = "id,account_id,email,name,display_name,role,availability,active,created,last_login";
const MEMBER_COLUMNS: &str =
    "u.id,u.account_id,u.email,u.name,u.display_name,u.role,u.availability,u.active,u.created,u.last_login";

impl SqliteStore {
    fn require_user(&self, id: i64) -> Result<User> {
        self.user(id)?.ok_or_else(|| Error::internal("user vanished"))
    }

    fn require_team(&self, id: i64) -> Result<Team> {
        self.team(id)?.ok_or_else(|| Error::internal("team vanished"))
    }

    fn change_members(&self, sql: &str, group: i64, users: &[i64]) -> Result<()> {
        for user in users {
            self.exec(sql, vec![int(group), int(*user)])?;
        }
        Ok(())
    }
}

impl UsersRepo for SqliteStore {
    fn count_users(&self) -> Result<i64> {
        Ok(self.scalar("SELECT COUNT(*) FROM users", vec![])?.unwrap_or(0))
    }

    fn user(&self, id: i64) -> Result<Option<User>> {
        self.row(&format!("SELECT {USER_COLUMNS} FROM users WHERE id=?"), vec![int(id)], PLAIN)
    }

    fn users(&self) -> Result<Vec<User>> {
        self.rows(&format!("SELECT {USER_COLUMNS} FROM users ORDER BY name COLLATE NOCASE"), vec![], PLAIN)
    }

    fn credentials(&self, email: &str) -> Result<Option<Credentials>> {
        self.with(|c| {
            let mut statement = c.prepare_cached("SELECT id,password_hash,active FROM users WHERE email=?")?;
            let mut rows = statement.query([email])?;
            match rows.next()? {
                Some(row) => Ok(Some(Credentials {
                    id: row.get(0)?,
                    password_hash: row.get(1)?,
                    active: row.get::<_, i64>(2)? != 0,
                })),
                None => Ok(None),
            }
        })
    }

    fn password_hash(&self, id: i64) -> Result<Option<String>> {
        self.with(|c| {
            let mut statement = c.prepare_cached("SELECT password_hash FROM users WHERE id=?")?;
            let mut rows = statement.query([id])?;
            rows.next()?.map(|r| r.get(0)).transpose()
        })
    }

    fn create_user(&self, name: &str, email: &str, role: &str, password_hash: &str) -> Result<User> {
        let id = self.insert(
            "INSERT INTO users(email,name,password_hash,role,created) VALUES(?,?,?,?,?)",
            vec![text(email), text(name), text(password_hash), text(role), text(iso(now_ms()))],
        )?;
        self.require_user(id)
    }

    fn email_taken(&self, email: &str, except_id: i64) -> Result<bool> {
        Ok(self.scalar("SELECT 1 FROM users WHERE email=? AND id<>?", vec![text(email), int(except_id)])?.is_some())
    }

    fn update_user(&self, id: i64, changes: &UserChanges) -> Result<User> {
        let mut fields: Vec<(&str, Sql)> = Vec::new();
        if let Some(name) = &changes.name {
            fields.push(("name", text(name.as_str())));
        }
        if let Some(display) = &changes.display_name {
            fields.push(("display_name", opt_text(display.as_deref())));
        }
        if let Some(role) = &changes.role {
            fields.push(("role", text(role.as_str())));
        }
        if let Some(availability) = &changes.availability {
            fields.push(("availability", text(availability.as_str())));
        }
        if let Some(active) = changes.active {
            fields.push(("active", flag(active)));
        }
        if let Some(hash) = &changes.password_hash {
            fields.push(("password_hash", text(hash.as_str())));
        }
        self.update_fields("users", int(id), fields)?;
        self.require_user(id)
    }

    fn delete_user(&self, id: i64) -> Result<()> {
        self.exec("DELETE FROM users WHERE id=?", vec![int(id)]).map(drop)
    }

    fn count_admins(&self) -> Result<i64> {
        let sql = "SELECT COUNT(*) FROM users WHERE role='administrator' AND active=1";
        Ok(self.scalar(sql, vec![])?.unwrap_or(0))
    }

    fn create_web_session(&self, user_id: i64, ttl_ms: i64, user_agent: Option<&str>) -> Result<WebSession> {
        let (cookie, csrf) = (random_secret(), crate::application::crypto::base64url(&crate::application::crypto::random_bytes(24)));
        let agent: Option<String> = user_agent.map(|a| a.chars().take(200).collect()).filter(|a: &String| !a.is_empty());
        let now = now_ms();
        self.exec(
            "INSERT INTO user_sessions(id,user_id,csrf,created,expires,user_agent) VALUES(?,?,?,?,?,?)",
            vec![text(sha256_hex(&cookie)), int(user_id), text(csrf.as_str()), text(iso(now)), text(iso(now + ttl_ms)), opt_text(agent.as_deref())],
        )?;
        self.exec("UPDATE users SET last_login=? WHERE id=?", vec![text(iso(now)), int(user_id)])?;
        Ok(WebSession { cookie, csrf })
    }

    fn web_session(&self, cookie: &str) -> Result<Option<(i64, String)>> {
        if cookie.len() > 128 {
            return Ok(None);
        }
        let hash = sha256_hex(cookie);
        let found = self.with(|c| {
            let mut statement = c.prepare_cached("SELECT user_id,csrf FROM user_sessions WHERE id=? AND expires>?")?;
            let mut rows = statement.query([hash.as_str(), iso(now_ms()).as_str()])?;
            match rows.next()? {
                Some(row) => Ok(Some((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))),
                None => Ok(None),
            }
        })?;
        if found.is_some() {
            self.exec("UPDATE user_sessions SET last_seen=? WHERE id=?", vec![text(iso(now_ms())), text(hash)])?;
        }
        Ok(found)
    }

    fn delete_web_session(&self, cookie: &str) -> Result<()> {
        self.exec("DELETE FROM user_sessions WHERE id=?", vec![text(sha256_hex(cookie))]).map(drop)
    }

    fn delete_user_sessions(&self, user_id: i64) -> Result<()> {
        self.exec("DELETE FROM user_sessions WHERE user_id=?", vec![int(user_id)]).map(drop)
    }

    fn issue_api_token(&self, owner_type: &str, owner_id: i64) -> Result<String> {
        let token = format!("wahd_{}", random_secret());
        self.exec("DELETE FROM api_access_tokens WHERE owner_type=? AND owner_id=?", vec![text(owner_type), int(owner_id)])?;
        self.exec(
            "INSERT INTO api_access_tokens(id,owner_type,owner_id,hash,created) VALUES(?,?,?,?,?)",
            vec![text(uuid::Uuid::new_v4().to_string()), text(owner_type), int(owner_id), text(sha256_hex(&token)), text(iso(now_ms()))],
        )?;
        Ok(token)
    }

    fn api_token_owner(&self, token: &str) -> Result<Option<TokenOwner>> {
        if token.len() > 256 {
            return Ok(None);
        }
        let hash = sha256_hex(token);
        let owner = self.with(|c| {
            let mut statement = c.prepare_cached("SELECT owner_type,owner_id FROM api_access_tokens WHERE hash=?")?;
            let mut rows = statement.query([hash.as_str()])?;
            match rows.next()? {
                Some(row) => Ok(Some(TokenOwner { owner_type: row.get(0)?, owner_id: row.get(1)? })),
                None => Ok(None),
            }
        })?;
        if owner.is_some() {
            self.exec("UPDATE api_access_tokens SET last_used=? WHERE hash=?", vec![text(iso(now_ms())), text(hash)])?;
        }
        Ok(owner)
    }

    fn teams(&self) -> Result<Vec<Team>> {
        let sql = "SELECT t.*,(SELECT COUNT(*) FROM team_members m WHERE m.team_id=t.id) AS member_count FROM teams t ORDER BY name";
        self.rows(sql, vec![], PLAIN)
    }

    fn team(&self, id: i64) -> Result<Option<Team>> {
        self.row("SELECT * FROM teams WHERE id=?", vec![int(id)], PLAIN)
    }

    fn team_by_name(&self, name: &str, except_id: i64) -> Result<Option<Team>> {
        self.row("SELECT * FROM teams WHERE name=? AND id<>?", vec![text(name), int(except_id)], PLAIN)
    }

    fn create_team(&self, fields: &TeamFields) -> Result<Team> {
        let id = self.insert(
            "INSERT INTO teams(name,description,allow_auto_assign) VALUES(?,?,?)",
            vec![
                text(fields.name.clone().unwrap_or_default()),
                opt_text(fields.description.clone().flatten().as_deref()),
                flag(fields.allow_auto_assign.unwrap_or(true)),
            ],
        )?;
        self.require_team(id)
    }

    fn update_team(&self, id: i64, fields: &TeamFields) -> Result<Team> {
        let mut changes: Vec<(&str, Sql)> = Vec::new();
        if let Some(name) = &fields.name {
            changes.push(("name", text(name.as_str())));
        }
        if let Some(description) = &fields.description {
            changes.push(("description", opt_text(description.as_deref())));
        }
        if let Some(allow) = fields.allow_auto_assign {
            changes.push(("allow_auto_assign", flag(allow)));
        }
        self.update_fields("teams", int(id), changes)?;
        self.require_team(id)
    }

    fn delete_team(&self, id: i64) -> Result<()> {
        self.exec("DELETE FROM teams WHERE id=?", vec![int(id)]).map(drop)
    }

    fn team_members(&self, team_id: i64) -> Result<Vec<User>> {
        let sql = format!("SELECT {MEMBER_COLUMNS} FROM users u JOIN team_members m ON m.user_id=u.id WHERE m.team_id=? ORDER BY u.name");
        self.rows(&sql, vec![int(team_id)], PLAIN)
    }

    fn add_team_members(&self, team_id: i64, user_ids: &[i64]) -> Result<()> {
        self.change_members("INSERT OR IGNORE INTO team_members(team_id,user_id) VALUES(?,?)", team_id, user_ids)
    }

    fn remove_team_members(&self, team_id: i64, user_ids: &[i64]) -> Result<()> {
        self.change_members("DELETE FROM team_members WHERE team_id=? AND user_id=?", team_id, user_ids)
    }

    fn member_inbox_ids(&self, user_id: i64) -> Result<Vec<i64>> {
        self.with(|c| {
            let mut statement = c.prepare_cached("SELECT inbox_id FROM inbox_members WHERE user_id=?")?;
            let ids = statement.query_map([user_id], |r| r.get(0))?;
            ids.collect()
        })
    }

    fn inbox_members(&self, inbox_id: i64) -> Result<Vec<User>> {
        let sql = format!("SELECT {MEMBER_COLUMNS} FROM users u JOIN inbox_members m ON m.user_id=u.id WHERE m.inbox_id=? ORDER BY u.name");
        self.rows(&sql, vec![int(inbox_id)], PLAIN)
    }

    fn add_inbox_members(&self, inbox_id: i64, user_ids: &[i64]) -> Result<()> {
        self.change_members("INSERT OR IGNORE INTO inbox_members(inbox_id,user_id) VALUES(?,?)", inbox_id, user_ids)
    }

    fn remove_inbox_members(&self, inbox_id: i64, user_ids: &[i64]) -> Result<()> {
        self.change_members("DELETE FROM inbox_members WHERE inbox_id=? AND user_id=?", inbox_id, user_ids)
    }

    fn assignable_ids(&self, inbox_id: i64, team_id: Option<i64>) -> Result<Vec<i64>> {
        let team = if team_id.is_some() { "AND u.id IN (SELECT user_id FROM team_members WHERE team_id=?)" } else { "" };
        let sql = format!(
            "SELECT u.id FROM users u JOIN inbox_members m ON m.user_id=u.id
             WHERE m.inbox_id=? AND u.active=1 AND u.availability='online' {team}"
        );
        let mut params = vec![int(inbox_id)];
        params.extend(team_id.map(int));
        self.with(|c| {
            let mut statement = c.prepare_cached(&sql)?;
            let ids = statement.query_map(rusqlite::params_from_iter(params), |r| r.get(0))?;
            ids.collect()
        })
    }

    fn assignment_cursor(&self, inbox_id: i64) -> Result<Option<i64>> {
        self.scalar("SELECT last_user_id FROM inbox_assignment_cursor WHERE inbox_id=?", vec![int(inbox_id)])
    }

    fn set_assignment_cursor(&self, inbox_id: i64, user_id: i64) -> Result<()> {
        let sql = "INSERT INTO inbox_assignment_cursor(inbox_id,last_user_id) VALUES(?,?)
                   ON CONFLICT(inbox_id) DO UPDATE SET last_user_id=excluded.last_user_id";
        self.exec(sql, vec![int(inbox_id), opt_int(Some(user_id))]).map(drop)
    }
}
