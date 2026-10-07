//! SLA policies (Chatwoot SLA): administrators define targets, agents or automations apply them to
//! conversations, and a periodic check marks each SLA as hit or missed (alerting the assignee).
use super::helpdesk::HelpdeskService;
use crate::domain::actor::Actor;
use crate::domain::error::{fail, HelpdeskError, Result};
use crate::domain::helpdesk::require_admin;
use crate::domain::model::{Conversation, SlaPolicy};
use crate::domain::reports::percent;
use crate::domain::sla::{evaluate, SlaState};
use serde_json::{json, Value};

const MAX_THRESHOLD: i64 = 365 * 86_400;

fn validate(policy: &SlaPolicy) -> Result<()> {
    let thresholds = [
        policy.first_response_time_threshold,
        policy.next_response_time_threshold,
        policy.resolution_time_threshold,
    ];
    if thresholds.iter().all(Option::is_none) {
        return fail("Defina ao menos um prazo");
    }
    if thresholds.iter().flatten().any(|t| *t < 60 || *t > MAX_THRESHOLD) {
        return fail("Os prazos vão de 1 minuto a 365 dias");
    }
    Ok(())
}

impl HelpdeskService {
    pub fn sla_policies(&self) -> Result<Vec<SlaPolicy>> {
        self.core.repo.sla_policies()
    }

    fn find_sla(&self, id: i64) -> Result<SlaPolicy> {
        self.core
            .repo
            .sla_policy(id)?
            .ok_or_else(|| HelpdeskError::not_found("SLA não encontrado").into())
    }

    pub fn create_sla_policy(&self, actor: &Actor, policy: &SlaPolicy) -> Result<SlaPolicy> {
        require_admin(actor)?;
        validate(policy)?;
        self.core.repo.create_sla_policy(policy)
    }

    pub fn update_sla_policy(&self, actor: &Actor, policy: &SlaPolicy) -> Result<SlaPolicy> {
        require_admin(actor)?;
        self.find_sla(policy.id)?;
        validate(policy)?;
        self.core.repo.update_sla_policy(policy)
    }

    pub fn delete_sla_policy(&self, actor: &Actor, id: i64) -> Result<()> {
        require_admin(actor)?;
        self.find_sla(id)?;
        self.core.repo.delete_sla_policy(id)
    }

    fn sla_state(&self, conversation: &Conversation, policy: &SlaPolicy, applied_at: i64) -> Result<SlaState> {
        let resolved_at = match conversation.status.as_str() {
            "resolved" => self.core.repo.resolved_at(conversation.id)?,
            _ => None,
        };
        Ok(evaluate(policy, applied_at, conversation, resolved_at, self.core.now()))
    }

    /// Applies an SLA to the conversation (the clock starts now) and records an activity.
    pub fn apply_sla(&self, actor: &Actor, display_id: i64, policy_id: i64) -> Result<Value> {
        let conversation = self.core.load(Some(actor), display_id)?;
        let policy = self.find_sla(policy_id)?;
        self.core.commit(Some(actor), |events| {
            self.core.repo.apply_sla(conversation.id, policy.id, self.core.now())?;
            let who = actor.name().unwrap_or_else(|| "Sistema".into());
            self.core
                .activity(&conversation, format!("{who} aplicou o SLA “{}”", policy.name), events)?;
            events.push("conversation.updated", &conversation);
            Ok(())
        })?;
        self.conversation_sla(actor, display_id)
    }

    /// The SLA of a conversation with its deadlines, or `null` when none applies.
    pub fn conversation_sla(&self, actor: &Actor, display_id: i64) -> Result<Value> {
        let conversation = self.core.load(Some(actor), display_id)?;
        let Some(applied) = self.core.repo.applied_sla(conversation.id)? else {
            return Ok(Value::Null);
        };
        let policy = self.find_sla(applied.sla_policy_id)?;
        let state = self.sla_state(&conversation, &policy, applied.created_at)?;
        Ok(json!({ "policy": policy, "applied": applied, "state": state }))
    }

    /// Settles active SLAs: `missed` ones alert (event `sla.missed`), resolved in time become `hit`.
    pub fn check_slas(&self) -> Result<usize> {
        let repo = &self.core.repo;
        let mut changed = 0;
        for applied in repo.active_slas()? {
            let (Some(conversation), Some(policy)) = (
                repo.conversation_by_id(applied.conversation_id)?,
                repo.sla_policy(applied.sla_policy_id)?,
            ) else {
                continue;
            };
            let state = self.sla_state(&conversation, &policy, applied.created_at)?;
            match state.status {
                "missed" => {
                    repo.set_sla_status(conversation.id, "missed", Some(self.core.now()))?;
                    let data = json!({
                        "id": conversation.id, "display_id": conversation.display_id, "inbox_id": conversation.inbox_id,
                        "assignee_id": conversation.assignee_id, "sla_policy_id": policy.id, "missed": state.missed,
                    });
                    self.core.emit("sla.missed", &data, None);
                }
                "hit" => repo.set_sla_status(conversation.id, "hit", None)?,
                _ => continue,
            }
            changed += 1;
        }
        Ok(changed)
    }

    pub fn sla_metrics(&self, actor: &Actor, since: i64, until: i64) -> Result<Value> {
        require_admin(actor)?;
        let mut counts = self.core.repo.sla_counts(since, until)?;
        let number = |key: &str| counts[key].as_i64().unwrap_or(0);
        let rate = percent(number("hit"), number("hit") + number("missed"));
        counts["hit_rate"] = json!(rate);
        Ok(counts)
    }
}
