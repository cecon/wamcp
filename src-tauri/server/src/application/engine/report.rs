//! What the API shows: who may see the engine (administrators of the organization) and the full
//! picture of an activity tree (delegations, runs, tool calls, evidence, messages and audit).
use super::EngineService;
use crate::domain::actor::Actor;
use crate::domain::engine::grants::{EFFECTS, POLICIES};
use crate::domain::engine::model::{AgentPolicy, Memory};
use crate::domain::engine::tools::{self, TOOLS};
use crate::domain::error::{fail, fail_with, Result};
use crate::domain::helpdesk::require_admin;
use serde_json::{json, Value};

impl EngineService {
    /// The organization of an administrator; the engine is administrators-only.
    pub fn account_of(actor: &Actor) -> Result<i64> {
        require_admin(actor)?;
        match actor {
            Actor::User(user) => Ok(user.account_id),
            _ => fail_with("Somente administradores podem fazer isso", 403),
        }
    }

    /// The root activity and everything delegated below it.
    pub fn detail(&self, account_id: i64, id: i64) -> Result<Value> {
        let root = self.load(account_id, id)?;
        let delegations = self.store.delegations(account_id, &root.correlation_id)?;
        let mut activities = vec![root.clone()];
        for d in &delegations {
            activities.push(self.load(account_id, d.activity_id)?);
        }
        let mut items = Vec::new();
        for a in &activities {
            items.push(json!({
                "activity": a,
                "runs": self.store.runs(account_id, a.id)?,
                "tool_calls": self.store.tool_calls(account_id, a.id)?,
                "evidence": self.store.evidence(account_id, a.id)?,
                "messages": self.store.messages(account_id, a.id)?,
            }));
        }
        Ok(json!({
            "activity": root,
            "delegations": delegations,
            "tree": items,
            "audit": self.store.audit_events(account_id, root.id)?,
        }))
    }

    pub fn list(&self, account_id: i64) -> Result<Value> {
        Ok(json!(self.store.activities(account_id, 100)?))
    }

    pub fn policy(&self, account_id: i64, agent_id: i64) -> Result<Value> {
        self.agent(account_id, agent_id)?;
        let grants = self.store.grants(account_id, agent_id)?;
        Ok(json!({"policy": self.store.policy(account_id, agent_id)?, "grants": grants}))
    }

    pub fn save_policy(&self, account_id: i64, policy: AgentPolicy) -> Result<Value> {
        self.agent(account_id, policy.agent_id)?;
        if !POLICIES.contains(&policy.execution_policy.as_str()) {
            return fail("Política de execução inválida");
        }
        let policy = AgentPolicy { account_id, ..policy };
        self.store.save_policy(&policy)?;
        self.audit(
            account_id,
            None,
            Some(policy.agent_id),
            "policy.save",
            "saved",
            json!(policy),
        );
        self.policy(account_id, policy.agent_id)
    }

    /// Grants or removes (`effect` `None`) a business tool for an agent.
    pub fn grant(&self, account_id: i64, agent_id: i64, tool: &str, effect: Option<&str>) -> Result<Value> {
        let agent = self.agent(account_id, agent_id)?;
        if tools::find(tool).is_none_or(|t| t.builtin) {
            return fail("Ferramenta desconhecida ou que não precisa de permissão");
        }
        if effect.is_some_and(|e| !EFFECTS.contains(&e)) {
            return fail("Efeito inválido: use allow ou approval");
        }
        if effect.is_some() && agent.role.as_deref() == Some("coordinator") {
            return fail("Coordenadores não executam ferramentas: delegue para um operador");
        }
        self.store.set_grant(account_id, agent_id, tool, effect)?;
        self.audit(
            account_id,
            None,
            Some(agent_id),
            "grant.set",
            effect.unwrap_or("removed"),
            json!({"ferramenta": tool}),
        );
        self.policy(account_id, agent_id)
    }

    /// The tool catalog (for the UI) and the runtimes with whether each can run here.
    pub fn catalog(&self) -> Value {
        let tools: Vec<Value> = TOOLS
            .iter()
            .map(|t| {
                json!({"name": t.name, "description": t.description, "builtin": t.builtin,
                "side_effects": t.side_effects, "sensitive": t.sensitive})
            })
            .collect();
        let runtimes: Vec<Value> = self
            .runtimes()
            .into_iter()
            .map(|(id, check)| json!({"id": id, "available": check.is_ok(), "detail": check.err()}))
            .collect();
        json!({"tools": tools, "runtimes": runtimes})
    }

    pub fn agent_memories(&self, account_id: i64, agent_id: i64) -> Result<Vec<Memory>> {
        self.agent(account_id, agent_id)?;
        self.memories(account_id, agent_id)
    }
}
