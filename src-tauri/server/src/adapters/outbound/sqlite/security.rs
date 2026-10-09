use super::db::{int, iso, now_ms, opt_int, opt_text, text, Shape, SqliteStore, PLAIN};
use crate::application::ports::SecurityRepo;
use crate::domain::error::{Error, Result};
use crate::domain::model::{AuditLog, MfaState, NewAuditLog, SessionInfo};

const MFA: Shape = Shape {
    json: &["mfa_backup_codes"],
    bools: &[],
};
const AUDIT: Shape = Shape {
    json: &["details"],
    bools: &[],
};

fn codes(backup_codes: &[String]) -> Result<rusqlite::types::Value> {
    Ok(text(serde_json::to_string(backup_codes)?))
}

impl SecurityRepo for SqliteStore {
    fn mfa_state(&self, user_id: i64) -> Result<MfaState> {
        let sql = "SELECT mfa_secret,mfa_enabled,mfa_last_step,mfa_backup_codes FROM users WHERE id=?";
        self.row(sql, vec![int(user_id)], MFA)?
            .ok_or_else(|| Error::internal("user vanished"))
    }

    fn set_mfa(&self, user_id: i64, secret: Option<&str>, enabled: bool, backup_codes: &[String]) -> Result<()> {
        // A new secret starts over; keeping the secret keeps the last step so codes are never replayed.
        let sql = "UPDATE users SET mfa_last_step=CASE WHEN mfa_secret IS ?1 THEN mfa_last_step END,
                   mfa_secret=?1,mfa_enabled=?2,mfa_backup_codes=?3 WHERE id=?4";
        let params = vec![
            opt_text(secret),
            int(i64::from(enabled)),
            codes(backup_codes)?,
            int(user_id),
        ];
        self.exec(sql, params).map(drop)
    }

    fn set_mfa_step(&self, user_id: i64, step: i64) -> Result<()> {
        let sql = "UPDATE users SET mfa_last_step=? WHERE id=?";
        self.exec(sql, vec![int(step), int(user_id)]).map(drop)
    }

    fn set_backup_codes(&self, user_id: i64, backup_codes: &[String]) -> Result<()> {
        let sql = "UPDATE users SET mfa_backup_codes=? WHERE id=?";
        self.exec(sql, vec![codes(backup_codes)?, int(user_id)]).map(drop)
    }

    fn create_mfa_challenge(&self, token_hash: &str, user_id: i64, expires_at: i64) -> Result<()> {
        self.exec(
            "DELETE FROM mfa_challenges WHERE expires_at<?",
            vec![int(expires_at - 3600)],
        )?;
        let sql = "INSERT INTO mfa_challenges(id,user_id,expires_at) VALUES(?,?,?)";
        self.exec(sql, vec![text(token_hash), int(user_id), int(expires_at)])
            .map(drop)
    }

    fn mfa_challenge(&self, token_hash: &str, now: i64, max_attempts: i64) -> Result<Option<i64>> {
        let sql = "UPDATE mfa_challenges SET attempts=attempts+1 WHERE id=? AND expires_at>? AND attempts<?";
        if self.exec(sql, vec![text(token_hash), int(now), int(max_attempts)])? == 0 {
            return Ok(None);
        }
        self.scalar("SELECT user_id FROM mfa_challenges WHERE id=?", vec![text(token_hash)])
    }

    fn delete_mfa_challenge(&self, token_hash: &str) -> Result<()> {
        self.exec("DELETE FROM mfa_challenges WHERE id=?", vec![text(token_hash)])
            .map(drop)
    }

    fn user_sessions(&self, user_id: i64) -> Result<Vec<SessionInfo>> {
        let sql = "SELECT id,created,expires,last_seen,user_agent FROM user_sessions WHERE user_id=? AND expires>?
                   ORDER BY COALESCE(last_seen,created) DESC";
        self.rows(sql, vec![int(user_id), text(iso(now_ms()))], PLAIN)
    }

    fn delete_session(&self, user_id: i64, session_id: &str) -> Result<usize> {
        let sql = "DELETE FROM user_sessions WHERE user_id=? AND id=?";
        self.exec(sql, vec![int(user_id), text(session_id)])
    }

    fn delete_other_sessions(&self, user_id: i64, keep_id: &str) -> Result<()> {
        let sql = "DELETE FROM user_sessions WHERE user_id=? AND id<>?";
        self.exec(sql, vec![int(user_id), text(keep_id)]).map(drop)
    }

    fn add_audit_log(&self, e: &NewAuditLog) -> Result<()> {
        self.exec(
            "INSERT INTO audit_logs(user_id,action,auditable_type,auditable_id,details,ip_address,created_at)
             VALUES(?,?,?,?,?,?,?)",
            vec![
                opt_int(e.user_id),
                text(e.action.as_str()),
                text(e.auditable_type.as_str()),
                opt_int(e.auditable_id),
                text(serde_json::to_string(&e.details)?),
                opt_text(e.ip_address.as_deref()),
                int(e.created_at),
            ],
        )
        .map(drop)
    }

    fn audit_logs(&self, page: i64, per_page: i64) -> Result<Vec<AuditLog>> {
        let sql = "SELECT a.*, u.name AS user_name FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id
                   ORDER BY a.id DESC LIMIT ? OFFSET ?";
        let offset = (page.max(1) - 1) * per_page;
        self.rows(sql, vec![int(per_page), int(offset)], AUDIT)
    }
}
