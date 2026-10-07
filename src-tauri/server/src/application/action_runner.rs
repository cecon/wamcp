//! Runs automation/macro actions on a conversation through the regular use cases, so the actor's
//! permissions, activities and events apply exactly as if done by hand.
use super::helpdesk::HelpdeskService;
use crate::domain::actor::Actor;
use crate::domain::automation::raw_text;
use crate::domain::error::{fail, Error, Result};
use crate::domain::model::Action;
use serde_json::Value;

fn param_id(params: &[Value]) -> Option<i64> {
    params
        .first()
        .and_then(|p| p.as_i64().or_else(|| p.as_str()?.trim().parse().ok()))
}

impl HelpdeskService {
    async fn run_action(&self, actor: &Actor, id: i64, action: &Action) -> Result<()> {
        let params = &action.action_params;
        let current = self.core.load(Some(actor), id)?;
        let text = params.first().map(raw_text).unwrap_or_default();
        let titles: Vec<String> = params.iter().map(raw_text).collect();
        match action.action_name.as_str() {
            "assign_agent" | "assign_team" => {
                let Some(target) = param_id(params) else {
                    return fail("Informe o agente ou time");
                };
                let (agent, team) = match action.action_name.as_str() {
                    "assign_agent" => (Some(Some(target)), None),
                    _ => (None, Some(Some(target))),
                };
                self.assign(actor, id, agent, team).map(drop)
            }
            "remove_assigned_agent" => self.assign(actor, id, Some(None), None).map(drop),
            "remove_assigned_team" => self.assign(actor, id, None, Some(None)).map(drop),
            "add_label" => {
                let mut labels = current.labels.clone();
                labels.extend(titles.into_iter().filter(|t| !current.labels.contains(t)));
                self.set_labels(actor, id, &labels).map(drop)
            }
            "remove_label" => {
                let labels: Vec<String> = current.labels.into_iter().filter(|l| !titles.contains(l)).collect();
                self.set_labels(actor, id, &labels).map(drop)
            }
            "send_message" => self.reply(actor, id, &text, false).await.map(drop),
            "add_private_note" => self.reply(actor, id, &text, true).await.map(drop),
            "resolve_conversation" => self.toggle_status(actor, id, "resolved", None).map(drop),
            "open_conversation" => self.toggle_status(actor, id, "open", None).map(drop),
            "pending_conversation" => self.toggle_status(actor, id, "pending", None).map(drop),
            "snooze_conversation" => self.toggle_status(actor, id, "snoozed", None).map(drop),
            "mute_conversation" => self.set_muted(actor, id, true).map(drop),
            "set_priority" | "change_priority" => {
                let priority = (!text.is_empty() && text != "none").then_some(text.as_str());
                self.set_priority(actor, id, priority).map(drop)
            }
            _ => Ok(()),
        }
    }

    /// Runs every action in order; failures are collected and do not stop the remaining ones.
    pub async fn run_actions(&self, actor: &Actor, display_id: i64, actions: &[Action]) -> Vec<Error> {
        let mut errors = Vec::new();
        for action in actions {
            if let Err(error) = self.run_action(actor, display_id, action).await {
                errors.push(error);
            }
        }
        errors
    }
}
