//! Engine storage, part 3: who hears about a request (`engine_recipients`).
use super::db::{flag, int, iso, now_ms, opt_text, text, Shape, SqliteStore};
use crate::domain::engine::recipients::Recipient;
use crate::domain::error::Result;

const SHAPE: Shape = Shape {
    json: &[],
    bools: &["copy"],
};

/// With a name for the request's screen: the person, the contact, or the person of the chat.
const SELECT: &str = "SELECT r.id,r.activity_id,r.kind,r.target_id,r.copy,r.last_event,r.notified,r.error,
  CASE r.kind WHEN 'user' THEN (SELECT name FROM users WHERE id=r.target_id)
    WHEN 'contact' THEN (SELECT COALESCE(name,phone_number) FROM contacts WHERE id=r.target_id)
    ELSE (SELECT u.name FROM agent_chats c JOIN users u ON u.id=c.user_id WHERE c.id=r.target_id) END AS name
  FROM engine_recipients r";

impl SqliteStore {
    pub(super) fn add_recipient_row(
        &self,
        account_id: i64,
        activity_id: i64,
        kind: &str,
        target_id: i64,
        copy: bool,
        told: Option<&str>,
    ) -> Result<()> {
        self.exec(
            "INSERT OR IGNORE INTO engine_recipients(account_id,activity_id,kind,target_id,copy,last_event)
             VALUES(?,?,?,?,?,?)",
            vec![
                int(account_id),
                int(activity_id),
                text(kind),
                int(target_id),
                flag(copy),
                opt_text(told),
            ],
        )?;
        Ok(())
    }

    pub(super) fn recipient_rows(&self, account_id: i64, activity_id: i64) -> Result<Vec<Recipient>> {
        self.rows(
            &format!("{SELECT} WHERE r.account_id=? AND r.activity_id=? ORDER BY r.copy,r.id"),
            vec![int(account_id), int(activity_id)],
            SHAPE,
        )
    }

    /// Takes the recipient for `event` unless they were already told about it (at most once each).
    pub(super) fn claim_recipient_row(&self, id: i64, event: &str) -> Result<bool> {
        let changed = self.exec(
            "UPDATE engine_recipients SET last_event=?,notified=?,error=NULL
             WHERE id=? AND COALESCE(last_event,'')<>?",
            vec![text(event), text(iso(now_ms())), int(id), text(event)],
        )?;
        Ok(changed > 0)
    }

    pub(super) fn recipient_error_row(&self, id: i64, error: &str) -> Result<()> {
        self.exec(
            "UPDATE engine_recipients SET error=? WHERE id=?",
            vec![text(error), int(id)],
        )?;
        Ok(())
    }
}
