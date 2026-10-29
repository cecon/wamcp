//! `EngineRepo` over the SQLite store (queries live in `engine.rs` and `engine_runs.rs`).
use super::db::{int, iso, now_ms, opt_int, opt_text, text, SqliteStore, PLAIN};
use crate::application::ports::{EngineRepo, Usage};
use crate::domain::engine::model::{
    Activity, ActivityDraft, AgentMessage, AgentPolicy, AuditEvent, Delegation, EngineAgent, Evidence, Memory, Run,
    ToolCall, ToolGrant,
};
use crate::domain::error::{Error, Result};
use serde_json::Value;

impl EngineRepo for SqliteStore {
    fn engine_agent(&self, account_id: i64, agent_id: i64) -> Result<Option<EngineAgent>> {
        self.engine_agent_row(account_id, agent_id)
    }
    fn agents_with_skill(&self, account_id: i64, skill: &str) -> Result<Vec<EngineAgent>> {
        self.agents_with_skill_rows(account_id, skill)
    }
    fn directory(&self, account_id: i64) -> Result<Vec<EngineAgent>> {
        self.directory_rows(account_id)
    }
    fn policy(&self, account_id: i64, agent_id: i64) -> Result<AgentPolicy> {
        self.policy_row(account_id, agent_id)
    }
    fn save_policy(&self, policy: &AgentPolicy) -> Result<()> {
        self.save_policy_row(policy)
    }
    fn grants(&self, account_id: i64, agent_id: i64) -> Result<Vec<ToolGrant>> {
        self.grant_rows(account_id, agent_id)
    }
    fn set_grant(&self, account_id: i64, agent_id: i64, tool: &str, effect: Option<&str>) -> Result<()> {
        self.set_grant_row(account_id, agent_id, tool, effect)
    }

    fn create_activity(&self, draft: &ActivityDraft) -> Result<(Activity, bool)> {
        self.create_activity_row(draft)
    }
    fn activity(&self, account_id: i64, id: i64) -> Result<Option<Activity>> {
        self.activity_row(account_id, id)
    }
    fn activities(&self, account_id: i64, limit: i64) -> Result<Vec<Activity>> {
        self.activity_rows(account_id, limit)
    }
    fn move_activity(&self, id: i64, from: &str, to: &str, error: Option<&str>) -> Result<bool> {
        self.move_activity_row(id, from, to, error)
    }
    fn complete_activity(&self, id: i64, result: &str, evidence: &[String]) -> Result<bool> {
        self.complete_activity_row(id, result, evidence)
    }
    fn set_reply_state(&self, id: i64, state: Option<&str>) -> Result<()> {
        self.exec(
            "UPDATE engine_activities SET reply_state=?,updated=? WHERE id=?",
            vec![opt_text(state), text(iso(now_ms())), int(id)],
        )?;
        Ok(())
    }
    fn add_attempt(&self, id: i64) -> Result<i64> {
        self.exec(
            "UPDATE engine_activities SET attempts=attempts+1 WHERE id=?",
            vec![int(id)],
        )?;
        Ok(self
            .scalar("SELECT attempts FROM engine_activities WHERE id=?", vec![int(id)])?
            .unwrap_or(0))
    }
    fn unfinished_roots(&self) -> Result<Vec<Activity>> {
        self.unfinished_root_rows()
    }

    fn delegation_by_key(&self, parent_id: i64, request_key: &str) -> Result<Option<Delegation>> {
        Ok(self
            .delegation_rows(
                "parent_activity_id=? AND request_key=?",
                vec![int(parent_id), text(request_key)],
            )?
            .pop())
    }
    fn create_delegation(&self, delegation: &Delegation) -> Result<Delegation> {
        let id = self.insert_delegation(delegation)?;
        self.delegation_rows("id=?", vec![int(id)])?
            .pop()
            .ok_or_else(|| Error::internal("delegation not stored"))
    }
    fn delegations(&self, account_id: i64, correlation_id: &str) -> Result<Vec<Delegation>> {
        self.delegation_rows(
            "account_id=? AND correlation_id=?",
            vec![int(account_id), text(correlation_id)],
        )
    }
    fn chain(&self, activity_id: i64) -> Result<Vec<i64>> {
        self.chain_rows(activity_id)
    }

    fn create_run(&self, activity: &Activity, runtime: &str, model: Option<&str>, token: &str) -> Result<Run> {
        self.create_run_row(activity, runtime, model, token)
    }
    fn run_by_token(&self, token: &str) -> Result<Option<Run>> {
        Ok(self.run_rows("token=?", vec![text(token)])?.pop())
    }
    fn runs(&self, account_id: i64, activity_id: i64) -> Result<Vec<Run>> {
        self.run_rows(
            "account_id=? AND activity_id=?",
            vec![int(account_id), int(activity_id)],
        )
    }
    fn set_run_external(&self, id: i64, external_id: &str) -> Result<()> {
        self.exec(
            "UPDATE engine_runs SET external_id=? WHERE id=?",
            vec![text(external_id), int(id)],
        )?;
        Ok(())
    }
    fn finish_run(&self, id: i64, status: &str, error: Option<&str>) -> Result<()> {
        self.finish_run_row(id, status, error)
    }
    fn reopen_run(&self, id: i64) -> Result<()> {
        self.exec(
            "UPDATE engine_runs SET status='running',finished=NULL,error=NULL WHERE id=?",
            vec![int(id)],
        )?;
        Ok(())
    }
    fn add_usage(&self, id: i64, usage: &Usage, cost_source: &str) -> Result<()> {
        self.add_usage_row(id, usage, cost_source)
    }
    fn interrupt_runs(&self) -> Result<usize> {
        self.exec(
            "UPDATE engine_runs SET status='interrupted',finished=? WHERE status='running'",
            vec![text(iso(now_ms()))],
        )
    }
    fn tokens_since(&self, account_id: i64, agent_id: i64, since: &str) -> Result<i64> {
        Ok(self
            .scalar(
                "SELECT COALESCE(SUM(input_tokens+output_tokens),0) FROM engine_runs
                 WHERE account_id=? AND agent_id=? AND started>=?",
                vec![int(account_id), int(agent_id), text(since)],
            )?
            .unwrap_or(0))
    }

    fn tool_call_by_key(&self, activity_id: i64, call_key: &str) -> Result<Option<ToolCall>> {
        Ok(self
            .call_rows("activity_id=? AND call_key=?", vec![int(activity_id), text(call_key)])?
            .pop())
    }
    fn tool_call(&self, account_id: i64, id: i64) -> Result<Option<ToolCall>> {
        Ok(self
            .call_rows("account_id=? AND id=?", vec![int(account_id), int(id)])?
            .pop())
    }
    fn tool_calls(&self, account_id: i64, activity_id: i64) -> Result<Vec<ToolCall>> {
        self.call_rows(
            "account_id=? AND activity_id=?",
            vec![int(account_id), int(activity_id)],
        )
    }
    fn insert_tool_call(&self, call: &ToolCall) -> Result<ToolCall> {
        self.insert_call_row(call)
    }
    fn update_tool_call(&self, id: i64, status: &str, result: Option<&Value>, evidence_id: Option<&str>) -> Result<()> {
        self.update_call_row(id, status, result, evidence_id)
    }
    fn decide_tool_call(&self, id: i64, status: &str, decided_by: i64) -> Result<bool> {
        self.decide_call_row(id, status, decided_by)
    }

    fn add_evidence(&self, evidence: &Evidence) -> Result<()> {
        self.add_evidence_row(evidence)
    }
    fn evidence_ids_below(&self, activity_id: i64) -> Result<Vec<String>> {
        self.evidence_ids_below_rows(activity_id)
    }
    fn evidence(&self, account_id: i64, activity_id: i64) -> Result<Vec<Evidence>> {
        self.evidence_rows(account_id, activity_id)
    }

    fn add_message(
        &self,
        account_id: i64,
        activity_id: i64,
        from: Option<i64>,
        to: Option<i64>,
        body: &str,
    ) -> Result<()> {
        self.exec(
            "INSERT INTO engine_messages(account_id,activity_id,from_agent_id,to_agent_id,body,created) VALUES(?,?,?,?,?,?)",
            vec![
                int(account_id),
                int(activity_id),
                opt_int(from),
                opt_int(to),
                text(body),
                text(iso(now_ms())),
            ],
        )?;
        Ok(())
    }
    fn messages(&self, account_id: i64, activity_id: i64) -> Result<Vec<AgentMessage>> {
        self.rows(
            "SELECT id,activity_id,from_agent_id,to_agent_id,body,created FROM engine_messages
             WHERE account_id=? AND activity_id=? ORDER BY id",
            vec![int(account_id), int(activity_id)],
            PLAIN,
        )
    }
    fn audit(
        &self,
        account_id: i64,
        activity_id: Option<i64>,
        agent_id: Option<i64>,
        action: &str,
        outcome: &str,
        detail: &Value,
    ) -> Result<()> {
        self.audit_row(account_id, activity_id, agent_id, action, outcome, detail)
    }
    fn audit_events(&self, account_id: i64, activity_id: i64) -> Result<Vec<AuditEvent>> {
        self.audit_rows(account_id, activity_id)
    }

    fn remember(&self, memory: &Memory) -> Result<Memory> {
        self.remember_row(memory)
    }
    fn recall(&self, account_id: i64, agent_id: i64, term: &str) -> Result<Vec<Memory>> {
        self.recall_rows(account_id, agent_id, term)
    }
    fn correct_memory(&self, account_id: i64, id: i64, content: &str) -> Result<Option<Memory>> {
        let Some(old) = self.memory_row(account_id, id)? else {
            return Ok(None);
        };
        let new = Memory {
            content: content.into(),
            version: old.version + 1,
            supersedes: Some(old.id),
            ..old
        };
        self.remember_row(&new).map(Some)
    }
    fn forget_memory(&self, account_id: i64, id: i64) -> Result<bool> {
        self.forget_row(account_id, id)
    }
}
