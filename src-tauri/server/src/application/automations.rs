//! Automation rules (Chatwoot's AutomationRuleListener): when an event matches a rule's conditions,
//! its actions run through the regular use cases as an "automation" actor. Events caused by
//! automations never trigger rules again, which prevents loops.
use super::event_bus::Envelope;
use super::helpdesk::HelpdeskService;
use super::ports::NewRule;
use crate::domain::actor::Actor;
use crate::domain::automation::{automation_events_for, matches_conditions, raw_text, validate_rule};
use crate::domain::error::{HelpdeskError, Result};
use crate::domain::helpdesk::require_admin;
use crate::domain::model::{AutomationRule, Conversation, RuleFields};
use serde_json::{json, Value};

#[derive(Clone)]
pub struct AutomationService {
    pub helpdesk: HelpdeskService,
}

fn context(conversation: &Conversation, message: Option<&Value>) -> Value {
    let id = |v: Option<i64>| v.map(|v| v.to_string());
    json!({
        "content": message.map(|m| m["content"].clone()),
        "message_type": message.map(|m| m["message_type"].clone()),
        "status": conversation.status,
        "inbox_id": conversation.inbox_id.to_string(),
        "assignee_id": id(conversation.assignee_id),
        "team_id": id(conversation.team_id),
        "labels": conversation.labels,
        "contact_phone": conversation.contact_phone,
        "contact_name": conversation.contact_name,
    })
}

fn param_id(params: &[Value]) -> Option<i64> {
    params
        .first()
        .and_then(|p| p.as_i64().or_else(|| p.as_str()?.trim().parse().ok()))
}

impl AutomationService {
    fn find(&self, id: i64) -> Result<AutomationRule> {
        self.helpdesk
            .core
            .repo
            .automation_rule(id)?
            .ok_or_else(|| HelpdeskError::not_found("Automação não encontrada").into())
    }

    async fn run(&self, rule: &AutomationRule, conversation: &Conversation) {
        let actor = Actor::system("automation", &format!("Automação “{}”", rule.name));
        let id = conversation.display_id;
        let (hd, repo) = (&self.helpdesk, &self.helpdesk.core.repo);
        for action in &rule.actions {
            let params = &action.action_params;
            let Ok(Some(current)) = repo.conversation_by_id(conversation.id) else {
                continue;
            };
            let text = params.first().map(raw_text).unwrap_or_default();
            let titles = |p: &[Value]| p.iter().map(raw_text).collect::<Vec<_>>();
            // One failing action (e.g. an agent removed from the inbox) must not stop the others.
            let _ = match action.action_name.as_str() {
                "assign_agent" => match param_id(params) {
                    Some(user) => hd.assign(&actor, id, Some(Some(user)), None).map(drop),
                    None => Ok(()),
                },
                "assign_team" => match param_id(params) {
                    Some(team) => hd.assign(&actor, id, None, Some(Some(team))).map(drop),
                    None => Ok(()),
                },
                "add_label" => {
                    let mut labels = current.labels.clone();
                    labels.extend(titles(params).into_iter().filter(|t| !current.labels.contains(t)));
                    hd.set_labels(&actor, id, &labels).map(drop)
                }
                "remove_label" => {
                    let removed = titles(params);
                    let labels: Vec<String> = current.labels.into_iter().filter(|l| !removed.contains(l)).collect();
                    hd.set_labels(&actor, id, &labels).map(drop)
                }
                "send_message" => hd.reply(&actor, id, &text, false).await.map(drop),
                "add_private_note" => hd.reply(&actor, id, &text, true).await.map(drop),
                "resolve_conversation" => hd.toggle_status(&actor, id, "resolved", None).map(drop),
                "open_conversation" => hd.toggle_status(&actor, id, "open", None).map(drop),
                "set_priority" => hd.set_priority(&actor, id, Some(text.as_str())).map(drop),
                _ => Ok(()),
            };
        }
    }

    pub async fn on_event(&self, envelope: Envelope) {
        if envelope.performer.is("automation") {
            return;
        }
        let repo = &self.helpdesk.core.repo;
        let is_message = envelope.event == "message.created";
        let key = if is_message { "conversation_id" } else { "id" };
        for name in automation_events_for(&envelope.event, &envelope.data) {
            let Some(conversation_id) = envelope.data[key].as_i64() else {
                continue;
            };
            let Ok(Some(conversation)) = repo.conversation_by_id(conversation_id) else {
                continue;
            };
            let message = is_message.then_some(&envelope.data);
            let Ok(rules) = repo.active_rules(name) else {
                continue;
            };
            for rule in rules {
                if matches_conditions(&rule.conditions, &context(&conversation, message)) {
                    self.run(&rule, &conversation).await;
                }
            }
        }
    }

    pub fn list(&self, actor: &Actor) -> Result<Vec<AutomationRule>> {
        require_admin(actor)?;
        self.helpdesk.core.repo.automation_rules()
    }

    pub fn create(&self, actor: &Actor, rule: &NewRule) -> Result<AutomationRule> {
        require_admin(actor)?;
        validate_rule(&rule.event_name, &rule.conditions, &rule.actions)?;
        self.helpdesk.core.repo.create_rule(rule)
    }

    pub fn update(&self, actor: &Actor, id: i64, fields: &RuleFields) -> Result<AutomationRule> {
        require_admin(actor)?;
        let current = self.find(id)?;
        validate_rule(
            fields.event_name.as_deref().unwrap_or(&current.event_name),
            fields.conditions.as_deref().unwrap_or(&current.conditions),
            fields.actions.as_deref().unwrap_or(&current.actions),
        )?;
        self.helpdesk.core.repo.update_rule(id, fields)
    }

    pub fn remove(&self, actor: &Actor, id: i64) -> Result<()> {
        require_admin(actor)?;
        self.find(id)?;
        self.helpdesk.core.repo.delete_rule(id)
    }
}
