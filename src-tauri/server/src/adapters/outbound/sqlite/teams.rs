use super::db::{flag, int, opt_int, opt_text, text, SqliteStore, PLAIN};
use crate::application::ports::TeamsRepo;
use crate::domain::error::{Error, Result};
use crate::domain::model::{Team, TeamFields, User};
use rusqlite::types::Value as Sql;

const MEMBER_COLUMNS: &str =
    "u.id,u.account_id,u.email,u.name,u.display_name,u.role,u.availability,u.active,u.created,u.last_login";

impl SqliteStore {
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

impl TeamsRepo for SqliteStore {
    fn teams(&self) -> Result<Vec<Team>> {
        let sql = "SELECT t.*,(SELECT COUNT(*) FROM team_members m WHERE m.team_id=t.id) AS member_count FROM teams t ORDER BY name";
        self.rows(sql, vec![], PLAIN)
    }

    fn team(&self, id: i64) -> Result<Option<Team>> {
        self.row("SELECT * FROM teams WHERE id=?", vec![int(id)], PLAIN)
    }

    fn team_by_name(&self, name: &str, except_id: i64) -> Result<Option<Team>> {
        self.row(
            "SELECT * FROM teams WHERE name=? AND id<>?",
            vec![text(name), int(except_id)],
            PLAIN,
        )
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
        self.change_members(
            "INSERT OR IGNORE INTO team_members(team_id,user_id) VALUES(?,?)",
            team_id,
            user_ids,
        )
    }

    fn remove_team_members(&self, team_id: i64, user_ids: &[i64]) -> Result<()> {
        self.change_members(
            "DELETE FROM team_members WHERE team_id=? AND user_id=?",
            team_id,
            user_ids,
        )
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
        self.change_members(
            "INSERT OR IGNORE INTO inbox_members(inbox_id,user_id) VALUES(?,?)",
            inbox_id,
            user_ids,
        )
    }

    fn remove_inbox_members(&self, inbox_id: i64, user_ids: &[i64]) -> Result<()> {
        self.change_members(
            "DELETE FROM inbox_members WHERE inbox_id=? AND user_id=?",
            inbox_id,
            user_ids,
        )
    }

    fn assignable_ids(&self, inbox_id: i64, team_id: Option<i64>) -> Result<Vec<i64>> {
        let team = if team_id.is_some() {
            "AND u.id IN (SELECT user_id FROM team_members WHERE team_id=?)"
        } else {
            ""
        };
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
        self.scalar(
            "SELECT last_user_id FROM inbox_assignment_cursor WHERE inbox_id=?",
            vec![int(inbox_id)],
        )
    }

    fn set_assignment_cursor(&self, inbox_id: i64, user_id: i64) -> Result<()> {
        let sql = "INSERT INTO inbox_assignment_cursor(inbox_id,last_user_id) VALUES(?,?)
                   ON CONFLICT(inbox_id) DO UPDATE SET last_user_id=excluded.last_user_id";
        self.exec(sql, vec![int(inbox_id), opt_int(Some(user_id))]).map(drop)
    }
}
