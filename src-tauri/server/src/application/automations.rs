//! Automation rules (Chatwoot's AutomationRuleListener): when an event matches a rule's conditions,
//! its actions run through the regular use cases as an "automation" actor. Events caused by
//! automations never trigger rules again, which prevents loops.
use super::event_bus::Envelope;
use super::helpdesk::HelpdeskService;
use super::ports::NewRule;
use crate::domain::actor::Actor;
use crate::domain::automation::{automation_events_for, matches_conditions, validate_rule};
use crate::domain::error::{HelpdeskError, Result};
use crate::domain::helpdesk::require_admin;
use crate::domain::model::{AutomationRule, Conversation, RuleFields};
use serde_json::{json, Value};

#[derive(Clone)]
pub struct AutomationService {
    pub helpdesk: HelpdeskService,
}

fn context(conversation: &Conversation, email: Option<String>, message: Option<&Value>) -> Value {
    let id = |v: Option<i64>| v.map(|v| v.to_string());
    let mut context = json!({
        "content": message.map(|m| m["content"].clone()),
        "message_type": message.map(|m| m["message_type"].clone()),
        "status": conversation.status,
        "inbox_id": conversation.inbox_id.to_string(),
        "assignee_id": id(conversation.assignee_id),
        "team_id": id(conversation.team_id),
        "labels": conversation.labels,
        "contact_phone": conversation.contact_phone,
        "contact_name": conversation.contact_name,
        "contact_email": email,
        "priority": conversation.priority,
    });
    if let Some(attributes) = conversation.custom_attributes.as_object() {
        for (key, value) in attributes {
            context[format!("custom_attribute:{key}")] = value.clone();
        }
    }
    context
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
        let _ = self
            .helpdesk
            .run_actions(&actor, conversation.display_id, &rule.actions)
            .await;
    }

    /// Duplicates a rule (Chatwoot "clone"); the copy starts inactive.
    pub fn clone_rule(&self, actor: &Actor, id: i64) -> Result<AutomationRule> {
        require_admin(actor)?;
        let rule = self.find(id)?;
        self.helpdesk.core.repo.create_rule(&NewRule {
            name: format!("{} (cópia)", rule.name),
            description: rule.description,
            event_name: rule.event_name,
            conditions: rule.conditions,
            actions: rule.actions,
            active: false,
        })
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
            let email = repo
                .contact(conversation.contact_id)
                .ok()
                .flatten()
                .and_then(|c| c.email);
            let context = context(&conversation, email, message);
            for rule in rules {
                if matches_conditions(&rule.conditions, &context) {
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
