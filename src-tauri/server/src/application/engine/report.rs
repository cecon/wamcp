//! What the API shows: who may see the engine (administrators of the organization) and the full
//! picture of an activity tree (delegations, runs, tool calls, evidence, messages and audit).
use super::EngineService;
use crate::domain::actor::Actor;
use crate::domain::engine::activity::is_final;
use crate::domain::engine::grants::{EFFECTS, POLICIES};
use crate::domain::engine::model::{AgentPolicy, Memory};
use crate::domain::engine::recipients::Recipient;
use crate::domain::error::{fail, fail_with, Result};
use crate::domain::helpdesk::require_admin;
use crate::domain::model::{AgentRun, RUN_ENGINE, RUN_QUEUED};
use serde_json::{json, Value};
use std::collections::HashMap;

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
        let recipients = self.store.recipients(account_id, root.id)?;
        Ok(json!({
            "activity": root,
            "requester_name": self.requester_name(account_id, &root.requester, &recipients)?,
            "recipients": recipients,
            "delegations": delegations,
            "tree": items,
            "audit": self.store.audit_events(account_id, root.id)?,
        }))
    }

    /// Who asked, in words: the person, the contact, the agent that delegated or the routine.
    fn requester_name(&self, account_id: i64, requester: &str, recipients: &[Recipient]) -> Result<Option<String>> {
        let Some((kind, raw)) = requester.split_once(':') else {
            return Ok(None);
        };
        let id: i64 = raw.parse().unwrap_or_default();
        Ok(match kind {
            "user" => recipients.iter().find(|r| !r.copy).and_then(|r| r.name.clone()),
            "contact" => self
                .store
                .contact_identity(id)?
                .and_then(|(phone, name)| name.or(phone)),
            "agent" => self
                .store
                .directory(account_id)?
                .into_iter()
                .find(|a| a.id == id)
                .map(|a| a.name),
            "schedule" => Some(format!("Rotina #{id}")),
            _ => None,
        })
    }

    pub fn list(&self, account_id: i64) -> Result<Value> {
        Ok(json!(self.store.activities(account_id, 100)?))
    }

    /// Activities not finished yet, as runs of "Em execução" (the engine keeps them in its tables).
    pub fn active_runs(&self, account_id: i64) -> Result<Vec<AgentRun>> {
        let names: HashMap<i64, String> = self
            .store
            .directory(account_id)?
            .into_iter()
            .map(|a| (a.id, a.name))
            .collect();
        let ms = |at: &str| chrono::DateTime::parse_from_rfc3339(at).map_or(0, |t| t.timestamp_millis());
        let runs = self
            .store
            .activities(account_id, 100)?
            .into_iter()
            .filter(|a| !is_final(&a.status));
        Ok(runs
            .map(|a| {
                let title: String = a.request.chars().take(120).collect();
                let mut run = AgentRun::new(format!("{RUN_ENGINE}:{}", a.id), RUN_ENGINE, title);
                (run.state, run.agent_id) = (a.status, Some(a.agent_id));
                run.agent_name = names.get(&a.agent_id).cloned();
                (run.queued_at, run.updated_at) = (ms(&a.created), ms(&a.updated));
                run.started_at = (run.state != RUN_QUEUED).then_some(run.queued_at);
                run
            })
            .collect())
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
        // A grant of an uninstalled plugin's tool can still be removed.
        let known = self.tool(account_id, tool);
        if known.as_ref().is_some_and(|t| t.builtin) || (known.is_none() && effect.is_some()) {
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
    pub fn catalog(&self, account_id: i64) -> Value {
        let tools: Vec<Value> = self
            .tools(account_id)
            .into_iter()
            .map(|t| {
                json!({"name": t.name, "description": t.description, "builtin": t.builtin,
                "side_effects": t.side_effects, "sensitive": t.sensitive, "internal_only": t.internal_only})
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
