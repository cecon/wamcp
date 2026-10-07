//! Agent notifications (Chatwoot's NotificationListener) and the per-agent realtime stream.
//! - conversation_assignment: someone else assigned the conversation to you;
//! - assigned_conversation_new_message: the contact wrote in a conversation assigned to you;
//! - conversation_creation: a new conversation arrived in one of your inboxes and nobody took it.
use super::core::Core;
use super::event_bus::Envelope;
use crate::domain::actor::Performer;
use crate::domain::error::{HelpdeskError, Result};
use crate::domain::model::{Conversation, User};
use serde_json::{json, Value};

#[derive(Clone)]
pub struct NotificationService {
    pub core: Core,
}

impl NotificationService {
    fn notify(&self, user_id: i64, kind: &str, conversation: &Conversation, performer: Option<&Performer>) -> Result<()> {
        let actor = performer.filter(|p| p.is("user")).and_then(|p| p.id);
        let notification = self
            .core
            .repo
            .create_notification(user_id, kind, conversation.id, actor, self.core.now())?;
        self.core.emit("notification.created", &notification, None);
        Ok(())
    }

    pub fn on_event(&self, envelope: &Envelope) -> Result<()> {
        let (data, repo) = (&envelope.data, &self.core.repo);
        let conversation = |id: &Value| -> Result<Option<Conversation>> {
            match id.as_i64() {
                Some(id) => repo.conversation_by_id(id),
                None => Ok(None),
            }
        };
        match envelope.event.as_str() {
            "assignee.changed" => {
                let Some(assignee) = data["assignee_id"].as_i64() else {
                    return Ok(());
                };
                let performer = &envelope.performer;
                if performer.is("user") && performer.id == Some(assignee) {
                    return Ok(());
                }
                let current: Conversation = serde_json::from_value(data.clone())?;
                self.notify(assignee, "conversation_assignment", &current, Some(performer))
            }
            "message.created" if data["message_type"] == "incoming" => {
                match conversation(&data["conversation_id"])? {
                    Some(c) if c.assignee_id.is_some() => {
                        let assignee = c.assignee_id.unwrap_or_default();
                        self.notify(assignee, "assigned_conversation_new_message", &c, None)
                    }
                    _ => Ok(()),
                }
            }
            // Auto-assignment runs in the same commit; only still-unassigned conversations alert the inbox.
            "conversation.created" if data["status"] == "open" => match conversation(&data["id"])? {
                Some(c) if c.assignee_id.is_none() => {
                    for member in repo.inbox_members(c.inbox_id)? {
                        if member.is_active() && member.role != "administrator" {
                            self.notify(member.id, "conversation_creation", &c, None)?;
                        }
                    }
                    Ok(())
                }
                _ => Ok(()),
            },
            _ => Ok(()),
        }
    }

    pub fn list(&self, user: &User) -> Result<Value> {
        Ok(json!({
            "items": self.core.repo.notifications(user.id, 50)?,
            "unread": self.core.repo.unread_notifications(user.id)?,
        }))
    }

    pub fn unread_count(&self, user: &User) -> Result<Value> {
        Ok(json!({ "unread": self.core.repo.unread_notifications(user.id)? }))
    }

    pub fn read(&self, user: &User, id: i64) -> Result<Value> {
        if self.core.repo.read_notification(user.id, id, self.core.now())? == 0 {
            return Err(HelpdeskError::not_found("Notificação não encontrada").into());
        }
        self.unread_count(user)
    }

    pub fn read_all(&self, user: &User) -> Result<Value> {
        self.core.repo.read_all_notifications(user.id, self.core.now())?;
        Ok(json!({ "unread": 0 }))
    }

    /// Per-agent visibility of a bus event (Chatwoot's RoomChannel): administrators get everything,
    /// agents get events from their inboxes, and notifications go only to their owner.
    pub fn visible_to(&self, user: &User, envelope: &Envelope) -> bool {
        let data = &envelope.data;
        if envelope.event.starts_with("notification.") {
            return data["user_id"].as_i64() == Some(user.id);
        }
        if user.role == "administrator" {
            return true;
        }
        match data.get("inbox_id") {
            None => true,
            Some(inbox) => self
                .core
                .repo
                .member_inbox_ids(user.id)
                .is_ok_and(|ids| inbox.as_i64().is_some_and(|id| ids.contains(&id))),
        }
    }
}
