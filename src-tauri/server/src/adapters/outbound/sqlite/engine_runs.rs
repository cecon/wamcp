//! Engine storage, part 2: runs, tool calls, evidence, messages between agents, audit and memory.
use super::db::{int, iso, now_ms, opt_int, opt_text, text, Shape, SqliteStore, PLAIN};
use crate::application::ports::Usage;
use crate::domain::engine::model::{Activity, Evidence, Memory, Run, ToolCall};
use crate::domain::error::{Error, Result};
use rusqlite::types::Value as Sql;
use serde_json::Value;

const CALL_SHAPE: Shape = Shape {
    json: &["args", "result"],
    bools: &[],
};
const EVIDENCE_SHAPE: Shape = Shape {
    json: &["content"],
    bools: &[],
};
const AUDIT_SHAPE: Shape = Shape {
    json: &["detail"],
    bools: &[],
};
const MEMORY: &str =
    "SELECT id,account_id,agent_id,kind,content,source,visibility,valid_until,version,supersedes,created
  FROM engine_memories";

impl SqliteStore {
    pub(super) fn create_run_row(&self, a: &Activity, runtime: &str, model: Option<&str>, token: &str) -> Result<Run> {
        let attempt = self
            .scalar("SELECT COUNT(*) FROM engine_runs WHERE activity_id=?", vec![int(a.id)])?
            .unwrap_or(0)
            + 1;
        let id = self.insert(
            "INSERT INTO engine_runs(account_id,activity_id,agent_id,runtime,model,token,status,attempt,started)
             VALUES(?,?,?,?,?,?,'running',?,?)",
            vec![
                int(a.account_id),
                int(a.id),
                int(a.agent_id),
                text(runtime),
                opt_text(model),
                text(token),
                int(attempt),
                text(iso(now_ms())),
            ],
        )?;
        self.row("SELECT * FROM engine_runs WHERE id=?", vec![int(id)], PLAIN)?
            .ok_or_else(|| Error::internal("run not stored"))
    }

    pub(super) fn run_rows(&self, filter: &str, params: Vec<Sql>) -> Result<Vec<Run>> {
        self.rows(
            &format!("SELECT * FROM engine_runs WHERE {filter} ORDER BY id"),
            params,
            PLAIN,
        )
    }

    pub(super) fn finish_run_row(&self, id: i64, status: &str, error: Option<&str>) -> Result<()> {
        self.exec(
            "UPDATE engine_runs SET status=?,error=?,finished=? WHERE id=? AND status='running'",
            vec![text(status), opt_text(error), text(iso(now_ms())), int(id)],
        )?;
        Ok(())
    }

    /// Adds to the run's totals and records the same usage in `llm_usage` (the members panel's
    /// salary), linked by `run_ref` `engine_run:<id>`.
    pub(super) fn add_usage_row(&self, id: i64, u: &Usage, cost_source: &str) -> Result<()> {
        let cost = Sql::Real(u.cost_usd.unwrap_or(0.0));
        self.transaction(&mut || {
            self.exec(
                "UPDATE engine_runs SET input_tokens=input_tokens+?,output_tokens=output_tokens+?,
                   cached_tokens=cached_tokens+?,cost_usd=COALESCE(cost_usd,0)+?,cost_source=? WHERE id=?",
                vec![
                    int(u.input_tokens),
                    int(u.output_tokens),
                    int(u.cached_tokens),
                    cost.clone(),
                    text(cost_source),
                    int(id),
                ],
            )?;
            self.exec(
                "INSERT INTO llm_usage(agent_id,run_ref,provider,model,input_tokens,cached_tokens,output_tokens,cost,
                   currency,cost_source,at)
                 SELECT agent_id,'engine_run:'||id,runtime,model,?,?,?,?,'USD',?,? FROM engine_runs WHERE id=?",
                vec![
                    int(u.input_tokens),
                    int(u.cached_tokens),
                    int(u.output_tokens),
                    cost.clone(),
                    text(cost_source),
                    text(iso(now_ms())),
                    int(id),
                ],
            )?;
            Ok(())
        })
    }

    pub(super) fn call_rows(&self, filter: &str, params: Vec<Sql>) -> Result<Vec<ToolCall>> {
        self.rows(
            &format!("SELECT * FROM engine_tool_calls WHERE {filter} ORDER BY id"),
            params,
            CALL_SHAPE,
        )
    }

    pub(super) fn insert_call_row(&self, c: &ToolCall) -> Result<ToolCall> {
        let id = self.insert(
            "INSERT INTO engine_tool_calls(account_id,activity_id,run_id,agent_id,tool,args,call_key,status,result,
               evidence_id,created) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
            vec![
                int(c.account_id),
                int(c.activity_id),
                int(c.run_id),
                int(c.agent_id),
                text(&c.tool),
                text(c.args.to_string()),
                text(&c.call_key),
                text(&c.status),
                opt_text(c.result.as_ref().map(Value::to_string).as_deref()),
                opt_text(c.evidence_id.as_deref()),
                text(iso(now_ms())),
            ],
        )?;
        self.call_rows("id=?", vec![int(id)])?
            .pop()
            .ok_or_else(|| Error::internal("tool call not stored"))
    }

    pub(super) fn update_call_row(
        &self,
        id: i64,
        status: &str,
        result: Option<&Value>,
        evidence: Option<&str>,
    ) -> Result<()> {
        self.exec(
            "UPDATE engine_tool_calls SET status=?,result=COALESCE(?,result),evidence_id=COALESCE(?,evidence_id) WHERE id=?",
            vec![
                text(status),
                opt_text(result.map(Value::to_string).as_deref()),
                opt_text(evidence),
                int(id),
            ],
        )?;
        Ok(())
    }

    pub(super) fn decide_call_row(&self, id: i64, status: &str, decided_by: i64) -> Result<bool> {
        Ok(self.exec(
            "UPDATE engine_tool_calls SET status=?,decided_by=? WHERE id=? AND status='pending_approval'",
            vec![text(status), int(decided_by), int(id)],
        )? == 1)
    }

    pub(super) fn add_evidence_row(&self, e: &Evidence) -> Result<()> {
        self.exec(
            "INSERT OR IGNORE INTO engine_evidence(id,account_id,activity_id,tool_call_id,source,content,created)
             VALUES(?,?,?,?,?,?,?)",
            vec![
                text(&e.id),
                int(e.account_id),
                int(e.activity_id),
                opt_int(e.tool_call_id),
                text(&e.source),
                text(e.content.to_string()),
                text(iso(now_ms())),
            ],
        )?;
        Ok(())
    }

    pub(super) fn evidence_rows(&self, account_id: i64, activity_id: i64) -> Result<Vec<Evidence>> {
        self.rows(
            "SELECT * FROM engine_evidence WHERE account_id=? AND activity_id=? ORDER BY created",
            vec![int(account_id), int(activity_id)],
            EVIDENCE_SHAPE,
        )
    }

    pub(super) fn evidence_ids_below_rows(&self, activity_id: i64) -> Result<Vec<String>> {
        let rows: Vec<Value> = self.rows(
            "WITH RECURSIVE down(id) AS (SELECT ? UNION ALL SELECT e.id FROM engine_activities e JOIN down ON e.parent_id=down.id)
             SELECT v.id FROM engine_evidence v WHERE v.activity_id IN (SELECT id FROM down)",
            vec![int(activity_id)],
            PLAIN,
        )?;
        Ok(rows
            .iter()
            .filter_map(|r| r["id"].as_str().map(str::to_string))
            .collect())
    }

    pub(super) fn audit_row(
        &self,
        account_id: i64,
        activity: Option<i64>,
        agent: Option<i64>,
        action: &str,
        outcome: &str,
        detail: &Value,
    ) -> Result<()> {
        self.exec(
            "INSERT INTO engine_audit(account_id,activity_id,agent_id,action,outcome,detail,at) VALUES(?,?,?,?,?,?,?)",
            vec![
                int(account_id),
                opt_int(activity),
                opt_int(agent),
                text(action),
                text(outcome),
                text(detail.to_string()),
                text(iso(now_ms())),
            ],
        )?;
        Ok(())
    }

    pub(super) fn audit_rows<T: serde::de::DeserializeOwned>(
        &self,
        account_id: i64,
        activity_id: i64,
    ) -> Result<Vec<T>> {
        self.rows(
            "SELECT id,activity_id,agent_id,action,outcome,detail,at FROM engine_audit WHERE account_id=? AND activity_id IN
               (WITH RECURSIVE down(id) AS (SELECT ? UNION ALL SELECT e.id FROM engine_activities e JOIN down ON e.parent_id=down.id)
                SELECT id FROM down) ORDER BY id",
            vec![int(account_id), int(activity_id)],
            AUDIT_SHAPE,
        )
    }

    pub(super) fn remember_row(&self, m: &Memory) -> Result<Memory> {
        let id = self.insert(
            "INSERT INTO engine_memories(account_id,agent_id,kind,content,source,visibility,valid_until,version,supersedes,created)
             VALUES(?,?,?,?,?,?,?,?,?,?)",
            vec![
                int(m.account_id),
                int(m.agent_id),
                text(&m.kind),
                text(&m.content),
                opt_text(m.source.as_deref()),
                text(&m.visibility),
                opt_text(m.valid_until.as_deref()),
                int(m.version),
                opt_int(m.supersedes),
                text(iso(now_ms())),
            ],
        )?;
        self.memory_row(m.account_id, id)?
            .ok_or_else(|| Error::internal("memory not stored"))
    }

    pub(super) fn memory_row(&self, account_id: i64, id: i64) -> Result<Option<Memory>> {
        self.row(
            &format!("{MEMORY} WHERE account_id=? AND id=? AND deleted=0"),
            vec![int(account_id), int(id)],
            PLAIN,
        )
    }

    pub(super) fn recall_rows(&self, account_id: i64, agent_id: i64, term: &str) -> Result<Vec<Memory>> {
        self.rows(
            &format!(
                "{MEMORY} m WHERE account_id=? AND deleted=0 AND (agent_id=? OR visibility='organization')
                   AND (valid_until IS NULL OR valid_until>?) AND content LIKE ? ESCAPE '\\'
                   AND NOT EXISTS(SELECT 1 FROM engine_memories n WHERE n.supersedes=m.id AND n.deleted=0)
                 ORDER BY id DESC LIMIT 20"
            ),
            vec![
                int(account_id),
                int(agent_id),
                text(iso(now_ms())),
                text(format!(
                    "%{}%",
                    term.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_")
                )),
            ],
            PLAIN,
        )
    }

    pub(super) fn forget_row(&self, account_id: i64, id: i64) -> Result<bool> {
        Ok(self.exec(
            // Erasing a corrected memory erases every earlier version too.
            "WITH RECURSIVE chain(id,sup) AS (SELECT id,supersedes FROM engine_memories WHERE account_id=? AND id=? AND deleted=0
               UNION ALL SELECT m.id,m.supersedes FROM engine_memories m JOIN chain ON m.id=chain.sup)
             UPDATE engine_memories SET deleted=1 WHERE id IN (SELECT id FROM chain) AND deleted=0",
            vec![int(account_id), int(id)],
        )? > 0)
    }
}
