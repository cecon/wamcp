//! Engine storage, part 1: the directory (AI agents and skills), policies, grants, activities and delegations.
use super::db::{flag, int, iso, now_ms, opt_int, opt_text, text, Shape, SqliteStore, PLAIN};
use crate::domain::engine::model::{Activity, ActivityDraft, AgentPolicy, Delegation, EngineAgent, ToolGrant};
use crate::domain::error::Result;

/// Skills of agent `a` with profile `p`: the agent's own and the profile's.
const SKILL_IDS: &str =
    "SELECT skill_id FROM agent_skills WHERE agent_id=a.id UNION SELECT skill_id FROM custom_role_skills WHERE role_id=p.id";

fn agent_sql(filter: &str) -> String {
    format!(
        "SELECT a.id,a.account_id,a.name,p.agent_role AS role,a.runtime,a.model,a.instructions,
           (SELECT json_group_array(s.name) FROM skills s WHERE s.id IN ({SKILL_IDS})) AS skills,
           (SELECT COALESCE(group_concat('## '||s.name||char(10)||s.instructions, char(10)||char(10)),'')
              FROM skills s WHERE s.id IN ({SKILL_IDS})) AS skill_text
         FROM agents a LEFT JOIN users u ON u.id=a.user_id
         LEFT JOIN custom_roles p ON p.id=COALESCE(u.custom_role_id,a.profile_id)
         WHERE a.kind='ai' AND a.active=1 AND a.account_id=? {filter}"
    )
}

const AGENT_SHAPE: Shape = Shape {
    json: &["skills"],
    bools: &[],
};
const ACTIVITY_SHAPE: Shape = Shape {
    json: &["evidence"],
    bools: &[],
};
const POLICY_SHAPE: Shape = Shape {
    json: &[],
    bools: &["enabled", "proactive_enabled"],
};

impl SqliteStore {
    pub(super) fn engine_agent_row(&self, account_id: i64, agent_id: i64) -> Result<Option<EngineAgent>> {
        self.row(
            &agent_sql("AND a.id=?"),
            vec![int(account_id), int(agent_id)],
            AGENT_SHAPE,
        )
    }

    pub(super) fn agents_with_skill_rows(&self, account_id: i64, skill: &str) -> Result<Vec<EngineAgent>> {
        let filter = format!(
            "AND EXISTS(SELECT 1 FROM skills s WHERE s.name=? COLLATE NOCASE AND s.id IN ({SKILL_IDS})) ORDER BY a.id"
        );
        self.rows(&agent_sql(&filter), vec![int(account_id), text(skill)], AGENT_SHAPE)
    }

    pub(super) fn directory_rows(&self, account_id: i64) -> Result<Vec<EngineAgent>> {
        self.rows(&agent_sql("ORDER BY a.id"), vec![int(account_id)], AGENT_SHAPE)
    }

    pub(super) fn policy_row(&self, account_id: i64, agent_id: i64) -> Result<AgentPolicy> {
        let found = self.row(
            "SELECT agent_id,account_id,enabled,proactive_enabled,execution_policy,max_concurrency,run_timeout_secs,
               monthly_token_budget FROM engine_agent_policies WHERE account_id=? AND agent_id=?",
            vec![int(account_id), int(agent_id)],
            POLICY_SHAPE,
        )?;
        Ok(found.unwrap_or(AgentPolicy {
            agent_id,
            account_id,
            enabled: true,
            proactive_enabled: false,
            execution_policy: crate::domain::engine::grants::APPROVAL_FOR_SENSITIVE.into(),
            max_concurrency: 2,
            run_timeout_secs: crate::domain::engine::RUN_TIMEOUT_SECS,
            monthly_token_budget: None,
        }))
    }

    pub(super) fn save_policy_row(&self, p: &AgentPolicy) -> Result<()> {
        self.exec(
            "INSERT INTO engine_agent_policies(agent_id,account_id,enabled,proactive_enabled,execution_policy,
               max_concurrency,run_timeout_secs,monthly_token_budget) VALUES(?,?,?,?,?,?,?,?)
             ON CONFLICT(agent_id) DO UPDATE SET enabled=excluded.enabled,proactive_enabled=excluded.proactive_enabled,
               execution_policy=excluded.execution_policy,max_concurrency=excluded.max_concurrency,
               run_timeout_secs=excluded.run_timeout_secs,monthly_token_budget=excluded.monthly_token_budget",
            vec![
                int(p.agent_id),
                int(p.account_id),
                flag(p.enabled),
                flag(p.proactive_enabled),
                text(&p.execution_policy),
                int(p.max_concurrency),
                int(p.run_timeout_secs),
                opt_int(p.monthly_token_budget),
            ],
        )?;
        Ok(())
    }

    pub(super) fn grant_rows(&self, account_id: i64, agent_id: i64) -> Result<Vec<ToolGrant>> {
        self.rows(
            "SELECT * FROM engine_tool_grants WHERE account_id=? AND agent_id=? ORDER BY tool",
            vec![int(account_id), int(agent_id)],
            PLAIN,
        )
    }

    pub(super) fn set_grant_row(&self, account_id: i64, agent_id: i64, tool: &str, effect: Option<&str>) -> Result<()> {
        match effect {
            Some(effect) => self.exec(
                "INSERT INTO engine_tool_grants(account_id,agent_id,tool,effect,created) VALUES(?,?,?,?,?)
                 ON CONFLICT(account_id,agent_id,tool) DO UPDATE SET effect=excluded.effect",
                vec![
                    int(account_id),
                    int(agent_id),
                    text(tool),
                    text(effect),
                    text(iso(now_ms())),
                ],
            )?,
            None => self.exec(
                "DELETE FROM engine_tool_grants WHERE account_id=? AND agent_id=? AND tool=?",
                vec![int(account_id), int(agent_id), text(tool)],
            )?,
        };
        Ok(())
    }

    pub(super) fn create_activity_row(&self, d: &ActivityDraft) -> Result<(Activity, bool)> {
        let now = text(iso(now_ms()));
        let params = vec![
            int(d.account_id),
            text(&d.requester),
            int(d.agent_id),
            opt_int(d.parent_id),
            int(d.priority),
            opt_text(d.deadline.as_deref()),
            text(&d.request),
            opt_text(d.idempotency_key.as_deref()),
            opt_int(d.conversation_id),
            text(&d.correlation_id),
            now.clone(),
            now,
        ];
        // Insert and read the id under one lock, so another thread's insert cannot slip in between.
        let (inserted, id) = self.with(|c| {
            let changed = c.execute(
                "INSERT INTO engine_activities(account_id,requester,agent_id,parent_id,status,priority,deadline,request,
                   idempotency_key,conversation_id,correlation_id,created,updated) VALUES(?,?,?,?,'queued',?,?,?,?,?,?,?,?)
                 ON CONFLICT(account_id,idempotency_key) DO NOTHING",
                rusqlite::params_from_iter(params),
            )?;
            Ok((changed, c.last_insert_rowid()))
        })?;
        let activity = if inserted == 1 {
            self.activity_row(d.account_id, id)?
        } else {
            self.row(
                "SELECT * FROM engine_activities WHERE account_id=? AND idempotency_key=?",
                vec![int(d.account_id), opt_text(d.idempotency_key.as_deref())],
                ACTIVITY_SHAPE,
            )?
        };
        let activity = activity.ok_or_else(|| crate::domain::error::Error::internal("activity not stored"))?;
        Ok((activity, inserted == 1))
    }

    pub(super) fn activity_row(&self, account_id: i64, id: i64) -> Result<Option<Activity>> {
        self.row(
            "SELECT * FROM engine_activities WHERE account_id=? AND id=?",
            vec![int(account_id), int(id)],
            ACTIVITY_SHAPE,
        )
    }

    pub(super) fn activity_rows(&self, account_id: i64, limit: i64) -> Result<Vec<Activity>> {
        self.rows(
            "SELECT * FROM engine_activities WHERE account_id=? ORDER BY id DESC LIMIT ?",
            vec![int(account_id), int(limit)],
            ACTIVITY_SHAPE,
        )
    }

    pub(super) fn move_activity_row(&self, id: i64, from: &str, to: &str, error: Option<&str>) -> Result<bool> {
        Ok(self.exec(
            "UPDATE engine_activities SET status=?,error=COALESCE(?,error),updated=? WHERE id=? AND status=?",
            vec![text(to), opt_text(error), text(iso(now_ms())), int(id), text(from)],
        )? == 1)
    }

    pub(super) fn complete_activity_row(&self, id: i64, result: &str, evidence: &[String]) -> Result<bool> {
        Ok(self.exec(
            "UPDATE engine_activities SET status='completed',result=?,evidence=?,error=NULL,updated=?
             WHERE id=? AND status IN ('queued','running','waiting_approval')",
            vec![
                text(result),
                text(serde_json::to_string(evidence)?),
                text(iso(now_ms())),
                int(id),
            ],
        )? == 1)
    }

    pub(super) fn unfinished_root_rows(&self) -> Result<Vec<Activity>> {
        self.rows(
            "SELECT * FROM engine_activities WHERE parent_id IS NULL AND status IN ('queued','running') ORDER BY id",
            vec![],
            ACTIVITY_SHAPE,
        )
    }

    pub(super) fn delegation_rows(
        &self,
        sql_filter: &str,
        params: Vec<rusqlite::types::Value>,
    ) -> Result<Vec<Delegation>> {
        self.rows(
            &format!("SELECT * FROM engine_delegations WHERE {sql_filter} ORDER BY id"),
            params,
            PLAIN,
        )
    }

    pub(super) fn insert_delegation(&self, d: &Delegation) -> Result<i64> {
        self.insert(
            "INSERT INTO engine_delegations(account_id,parent_activity_id,activity_id,from_agent_id,to_agent_id,skill,
               reason,request_key,correlation_id,depth,hops,created) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
            vec![
                int(d.account_id),
                int(d.parent_activity_id),
                int(d.activity_id),
                int(d.from_agent_id),
                int(d.to_agent_id),
                text(&d.skill),
                opt_text(d.reason.as_deref()),
                text(&d.request_key),
                text(&d.correlation_id),
                int(d.depth),
                int(d.hops),
                text(iso(now_ms())),
            ],
        )
    }

    /// Agents from the root activity down to `activity_id`.
    pub(super) fn chain_rows(&self, activity_id: i64) -> Result<Vec<i64>> {
        let ids: Vec<serde_json::Value> = self.rows(
            "WITH RECURSIVE up(id,parent_id,agent_id,depth) AS (
               SELECT id,parent_id,agent_id,0 FROM engine_activities WHERE id=?
               UNION ALL SELECT e.id,e.parent_id,e.agent_id,up.depth+1 FROM engine_activities e JOIN up ON e.id=up.parent_id)
             SELECT agent_id FROM up ORDER BY depth DESC",
            vec![int(activity_id)],
            PLAIN,
        )?;
        Ok(ids.iter().filter_map(|row| row["agent_id"].as_i64()).collect())
    }
}
