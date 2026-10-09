use super::db::{int, opt_int, opt_text, text, SqliteStore, PLAIN};
use crate::application::ports::{InsightsRepo, Period};
use crate::domain::error::{Error, Result};
use crate::domain::model::{CsatEntry, CsatResponse, ReportingEvent};
use rusqlite::types::Value as Sql;
use serde_json::{json, Value};

const RANGE: &str = "created_at>=? AND created_at<?";

fn args(p: &Period) -> Vec<Sql> {
    let mut values = vec![int(p.since), int(p.until)];
    values.extend(p.inbox_id.map(int));
    values
}

fn inbox_filter(p: &Period, prefix: &str) -> String {
    if p.inbox_id.is_some() {
        format!(" AND {prefix}inbox_id=?")
    } else {
        String::new()
    }
}

impl SqliteStore {
    fn average(&self, name: &str, p: &Period) -> Result<Value> {
        let sql = format!(
            "SELECT COUNT(*) AS count, AVG(value) AS average FROM reporting_events WHERE name=? AND {RANGE}{}",
            inbox_filter(p, "")
        );
        let mut params = vec![text(name)];
        params.extend(args(p));
        Ok(self.row::<Value>(&sql, params, PLAIN)?.unwrap_or(Value::Null))
    }

    fn period_count(&self, sql: &str, p: &Period) -> Result<i64> {
        Ok(self.scalar(sql, args(p))?.unwrap_or(0))
    }
}

impl InsightsRepo for SqliteStore {
    fn create_csat(&self, c: &CsatResponse) -> Result<CsatResponse> {
        let sql =
            "INSERT INTO csat_responses(conversation_id,contact_id,assignee_id,inbox_id,rating,feedback,created_at)
                   VALUES(?,?,?,?,?,?,?) ON CONFLICT(conversation_id) DO UPDATE SET rating=excluded.rating,
                   feedback=excluded.feedback,created_at=excluded.created_at";
        let params = vec![
            int(c.conversation_id),
            int(c.contact_id),
            opt_int(c.assignee_id),
            int(c.inbox_id),
            int(c.rating),
            opt_text(c.feedback.as_deref()),
            int(c.created_at),
        ];
        self.exec(sql, params)?;
        let sql = "SELECT * FROM csat_responses WHERE conversation_id=?";
        self.row(sql, vec![int(c.conversation_id)], PLAIN)?
            .ok_or_else(|| Error::internal("csat vanished"))
    }

    fn csat_responses(&self, p: &Period, limit: i64) -> Result<Vec<CsatEntry>> {
        let sql = format!(
            "SELECT r.*, c.display_id, ct.name AS contact_name, u.name AS assignee_name FROM csat_responses r
             JOIN conversations c ON c.id=r.conversation_id JOIN contacts ct ON ct.id=r.contact_id
             LEFT JOIN users u ON u.id=r.assignee_id WHERE r.{RANGE}{} ORDER BY r.created_at DESC LIMIT ?",
            inbox_filter(p, "r.")
        );
        let mut params = args(p);
        params.push(int(limit));
        self.rows(&sql, params, PLAIN)
    }

    fn record_event(&self, e: &ReportingEvent) -> Result<()> {
        let sql = "INSERT OR IGNORE INTO reporting_events(name,value,user_id,inbox_id,conversation_id,created_at) VALUES(?,?,?,?,?,?)";
        let params = vec![
            text(e.name),
            int(e.value),
            opt_int(e.user_id),
            int(e.inbox_id),
            int(e.conversation_id),
            int(e.created_at),
        ];
        self.exec(sql, params).map(drop)
    }

    fn first_incoming_at(&self, conversation_id: i64) -> Result<Option<i64>> {
        let sql =
            "SELECT MIN(created_at) FROM conversation_messages WHERE conversation_id=? AND message_type='incoming'";
        self.scalar(sql, vec![int(conversation_id)])
    }

    fn summary(&self, p: &Period) -> Result<Value> {
        let inbox = inbox_filter(p, "");
        let csat_sql =
            format!("SELECT COUNT(*) AS count, AVG(rating) AS average FROM csat_responses WHERE {RANGE}{inbox}");
        let created = "CAST(strftime('%s',created) AS INTEGER)";
        Ok(json!({
            "conversations": self.period_count(&format!("SELECT COUNT(*) FROM conversations WHERE {created}>=? AND {created}<?{inbox}"), p)?,
            "incoming_messages": self.period_count(&format!("SELECT COUNT(*) FROM conversation_messages WHERE message_type='incoming' AND {RANGE}{inbox}"), p)?,
            "outgoing_messages": self.period_count(&format!("SELECT COUNT(*) FROM conversation_messages WHERE message_type='outgoing' AND private=0 AND {RANGE}{inbox}"), p)?,
            "resolutions": self.average("conversation_resolved", p)?,
            "first_response": self.average("first_response", p)?,
            "csat": self.row::<Value>(&csat_sql, args(p), PLAIN)?.unwrap_or(Value::Null),
        }))
    }

    fn agent_report(&self, p: &Period) -> Result<Vec<Value>> {
        let sql = format!(
            "SELECT u.id, u.name,
               SUM(CASE WHEN e.name='conversation_resolved' THEN 1 ELSE 0 END) AS resolved,
               AVG(CASE WHEN e.name='first_response' THEN e.value END) AS avg_first_response,
               AVG(CASE WHEN e.name='conversation_resolved' THEN e.value END) AS avg_resolution,
               (SELECT AVG(r.rating) FROM csat_responses r WHERE r.assignee_id=u.id AND r.{RANGE}{}) AS csat
             FROM users u LEFT JOIN reporting_events e ON e.user_id=u.id AND e.{RANGE}{}
             GROUP BY u.id ORDER BY resolved DESC, u.name",
            inbox_filter(p, "r."),
            inbox_filter(p, "e.")
        );
        let mut params = args(p);
        params.extend(args(p));
        self.rows(&sql, params, PLAIN)
    }
}
