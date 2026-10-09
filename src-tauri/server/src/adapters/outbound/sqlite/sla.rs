use super::db::{int, iso, now_ms, opt_int, opt_text, text, SqliteStore, PLAIN};
use crate::application::ports::SlaRepo;
use crate::domain::error::{Error, Result};
use crate::domain::model::{AppliedSla, SlaPolicy};
use serde_json::Value;

impl SlaRepo for SqliteStore {
    fn sla_policies(&self) -> Result<Vec<SlaPolicy>> {
        self.rows("SELECT * FROM sla_policies ORDER BY name COLLATE NOCASE", vec![], PLAIN)
    }

    fn sla_policy(&self, id: i64) -> Result<Option<SlaPolicy>> {
        self.row("SELECT * FROM sla_policies WHERE id=?", vec![int(id)], PLAIN)
    }

    fn create_sla_policy(&self, p: &SlaPolicy) -> Result<SlaPolicy> {
        let id = self.insert(
            "INSERT INTO sla_policies(name,description,first_response_time_threshold,next_response_time_threshold,
               resolution_time_threshold,created) VALUES(?,?,?,?,?,?)",
            vec![
                text(p.name.as_str()),
                opt_text(p.description.as_deref()),
                opt_int(p.first_response_time_threshold),
                opt_int(p.next_response_time_threshold),
                opt_int(p.resolution_time_threshold),
                text(iso(now_ms())),
            ],
        )?;
        self.sla_policy(id)?.ok_or_else(|| Error::internal("sla vanished"))
    }

    fn update_sla_policy(&self, p: &SlaPolicy) -> Result<SlaPolicy> {
        self.exec(
            "UPDATE sla_policies SET name=?,description=?,first_response_time_threshold=?,next_response_time_threshold=?,
               resolution_time_threshold=? WHERE id=?",
            vec![
                text(p.name.as_str()),
                opt_text(p.description.as_deref()),
                opt_int(p.first_response_time_threshold),
                opt_int(p.next_response_time_threshold),
                opt_int(p.resolution_time_threshold),
                int(p.id),
            ],
        )?;
        self.sla_policy(p.id)?.ok_or_else(|| Error::internal("sla vanished"))
    }

    fn delete_sla_policy(&self, id: i64) -> Result<()> {
        self.exec("DELETE FROM sla_policies WHERE id=?", vec![int(id)])
            .map(drop)
    }

    fn apply_sla(&self, conversation_id: i64, policy_id: i64, at: i64) -> Result<AppliedSla> {
        let sql = "INSERT INTO applied_slas(conversation_id,sla_policy_id,created_at) VALUES(?,?,?)
                   ON CONFLICT(conversation_id) DO UPDATE SET sla_policy_id=excluded.sla_policy_id,
                   created_at=excluded.created_at,status='active',missed_at=NULL";
        self.exec(sql, vec![int(conversation_id), int(policy_id), int(at)])?;
        self.applied_sla(conversation_id)?
            .ok_or_else(|| Error::internal("applied sla vanished"))
    }

    fn applied_sla(&self, conversation_id: i64) -> Result<Option<AppliedSla>> {
        let sql = "SELECT * FROM applied_slas WHERE conversation_id=?";
        self.row(sql, vec![int(conversation_id)], PLAIN)
    }

    fn active_slas(&self) -> Result<Vec<AppliedSla>> {
        self.rows("SELECT * FROM applied_slas WHERE status='active'", vec![], PLAIN)
    }

    fn set_sla_status(&self, conversation_id: i64, status: &str, missed_at: Option<i64>) -> Result<()> {
        let sql = "UPDATE applied_slas SET status=?,missed_at=? WHERE conversation_id=?";
        self.exec(sql, vec![text(status), opt_int(missed_at), int(conversation_id)])
            .map(drop)
    }

    fn resolved_at(&self, conversation_id: i64) -> Result<Option<i64>> {
        let sql =
            "SELECT MAX(created_at) FROM reporting_events WHERE conversation_id=? AND name='conversation_resolved'";
        self.scalar(sql, vec![int(conversation_id)])
    }

    fn sla_counts(&self, since: i64, until: i64) -> Result<Value> {
        let sql = "SELECT COUNT(*) AS total, COALESCE(SUM(status='hit'),0) AS hit,
                   COALESCE(SUM(status='missed'),0) AS missed, COALESCE(SUM(status='active'),0) AS active FROM applied_slas WHERE created_at>=? AND created_at<?";
        Ok(self.row(sql, vec![int(since), int(until)], PLAIN)?.unwrap_or_default())
    }
}
