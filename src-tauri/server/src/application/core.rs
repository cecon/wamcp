//! Shared building blocks for conversation use cases: access, activities, auto-assignment, commits.
use super::event_bus::EventBus;
use super::ports::{transaction, Clock, Repository};
use crate::domain::actor::{Actor, Performer};
use crate::domain::error::{Error, HelpdeskError, Result};
use crate::domain::helpdesk::{assignment_activity, next_assignee, require_inbox_access};
use crate::domain::model::{Conversation, ConversationChanges, Inbox, NewMessage};
use serde::Serialize;
use serde_json::Value;
use std::sync::Arc;

/// Events produced by a unit of work, published only after it commits.
#[derive(Default)]
pub struct Events(Vec<(&'static str, Value)>);

impl Events {
    pub fn push(&mut self, name: &'static str, data: &impl Serialize) {
        self.0.push((name, serde_json::to_value(data).unwrap_or(Value::Null)));
    }
}

/// Repository, event bus and clock shared by every use case.
#[derive(Clone)]
pub struct Core {
    pub repo: Arc<dyn Repository>,
    pub bus: Arc<EventBus>,
    pub clock: Arc<dyn Clock>,
}

impl Core {
    pub fn now(&self) -> i64 {
        self.clock.now()
    }

    pub fn member_inbox_ids(&self, actor: &Actor) -> Result<Vec<i64>> {
        match actor {
            Actor::Bot { inbox_id } => Ok(vec![*inbox_id]),
            Actor::User(user) => self.repo.member_inbox_ids(user.id),
            Actor::System { .. } => Ok(Vec::new()),
        }
    }

    /// `None` means every inbox (administrators and automations).
    pub fn visible_inbox_ids(&self, actor: &Actor) -> Result<Option<Vec<i64>>> {
        if actor.is_admin() {
            Ok(None)
        } else {
            self.member_inbox_ids(actor).map(Some)
        }
    }

    pub fn inbox(&self, id: i64) -> Result<Inbox> {
        self.repo
            .inbox(id)?
            .ok_or_else(|| HelpdeskError::not_found("Caixa de entrada não encontrada").into())
    }

    pub fn load(&self, actor: Option<&Actor>, display_id: i64) -> Result<Conversation> {
        let conversation = self
            .repo
            .conversation(display_id)?
            .ok_or_else(|| Error::from(HelpdeskError::not_found("Conversa não encontrada")))?;
        if let Some(actor) = actor {
            require_inbox_access(actor, &self.member_inbox_ids(actor)?, conversation.inbox_id)?;
        }
        Ok(conversation)
    }

    pub fn update(&self, id: i64, changes: ConversationChanges) -> Result<Conversation> {
        self.repo.update_conversation(id, &changes)
    }

    pub fn activity(&self, conversation: &Conversation, content: String, events: &mut Events) -> Result<()> {
        let message = self.repo.insert_message(&NewMessage {
            conversation_id: conversation.id,
            inbox_id: conversation.inbox_id,
            message_type: "activity".into(),
            content: Some(content),
            sender_type: Some("system".into()),
            content_attributes: Value::Object(Default::default()),
            created_at: self.now(),
            ..NewMessage::default()
        })?;
        if let Some(message) = message {
            events.push("message.created", &message);
        }
        Ok(())
    }

    /// Round robin among online inbox members (restricted to the team when it allows auto-assign).
    pub fn auto_assign(&self, conversation: Conversation, events: &mut Events) -> Result<Conversation> {
        let inbox = self.inbox(conversation.inbox_id)?;
        if inbox.enable_auto_assignment == 0 || conversation.assignee_id.is_some() || conversation.status != "open" {
            return Ok(conversation);
        }
        let team = match conversation.team_id {
            Some(id) => self.repo.team(id)?,
            None => None,
        };
        let team_scope = team.filter(|t| t.allow_auto_assign != 0).map(|t| t.id);
        let candidates = self
            .repo
            .assignable_ids(inbox.id, team_scope, inbox.max_assignment_limit)?;
        let Some(chosen) = next_assignee(&candidates, self.repo.assignment_cursor(inbox.id)?) else {
            return Ok(conversation);
        };
        self.repo.set_assignment_cursor(inbox.id, chosen)?;
        self.repo.add_participant(conversation.id, chosen)?;
        let updated = self.update(
            conversation.id,
            ConversationChanges {
                assignee_id: Some(Some(chosen)),
                ..Default::default()
            },
        )?;
        self.activity(
            &updated,
            assignment_activity(None, updated.assignee_name.as_deref()),
            events,
        )?;
        events.push("assignee.changed", &updated);
        Ok(updated)
    }

    /// Runs a unit of work atomically and publishes its events only after commit.
    pub fn commit<T>(&self, actor: Option<&Actor>, work: impl FnOnce(&mut Events) -> Result<T>) -> Result<T> {
        let mut events = Events::default();
        let result = transaction(&*self.repo, || work(&mut events))?;
        let performer = actor.map(Actor::performer).unwrap_or_else(Performer::system);
        for (name, data) in events.0 {
            self.bus.emit(name, data, performer.clone());
        }
        Ok(result)
    }

    pub fn emit(&self, name: &str, data: &impl Serialize, actor: Option<&Actor>) {
        let performer = actor.map(Actor::performer).unwrap_or_else(Performer::system);
        self.bus
            .emit(name, serde_json::to_value(data).unwrap_or(Value::Null), performer);
    }
}
