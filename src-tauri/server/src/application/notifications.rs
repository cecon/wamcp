//! Agent notifications (Chatwoot's NotificationListener) and the per-agent realtime stream.
//! - conversation_assignment: someone else assigned the conversation to you;
//! - assigned_conversation_new_message: the contact wrote in a conversation assigned to you;
//! - conversation_creation: a new conversation arrived in one of your inboxes and nobody took it;
//! - conversation_mention: someone @mentioned you in a private note;
//! - participating_conversation_new_message: the contact wrote in a conversation you follow.
use super::core::Core;
use super::event_bus::Envelope;
use crate::domain::actor::Performer;
use crate::domain::error::{fail, HelpdeskError, Result};
use crate::domain::model::{Conversation, User};
use crate::domain::notifications::{is_enabled, mentioned_user_ids, NOTIFICATION_TYPES};
use serde_json::{json, Value};

#[derive(Clone)]
pub struct NotificationService {
    pub core: Core,
}

impl NotificationService {
    fn notify(
        &self,
        user_id: i64,
        kind: &str,
        conversation: &Conversation,
        performer: Option<&Performer>,
    ) -> Result<()> {
        if !is_enabled(&self.core.repo.notification_settings(user_id)?, kind) {
            return Ok(());
        }
        let actor = performer.filter(|p| p.is("user")).and_then(|p| p.id);
        let notification =
            self.core
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
            "message.created" if data["message_type"] == "incoming" => match conversation(&data["conversation_id"])? {
                Some(c) if c.muted == 0 => self.new_message(&c),
                _ => Ok(()),
            },
            "message.created" if data["private"] == true && data["sender_type"] == "user" => {
                match conversation(&data["conversation_id"])? {
                    Some(c) => self.mentions(&c, data, &envelope.performer),
                    None => Ok(()),
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

    /// The assignee and the other participants hear about new contact messages.
    fn new_message(&self, c: &Conversation) -> Result<()> {
        if let Some(assignee) = c.assignee_id {
            self.notify(assignee, "assigned_conversation_new_message", c, None)?;
        }
        for user in self.core.repo.participant_ids(c.id)? {
            if Some(user) != c.assignee_id {
                self.notify(user, "participating_conversation_new_message", c, None)?;
            }
        }
        Ok(())
    }

    /// Agents mentioned in a private note who can reach the inbox are recorded, follow the
    /// conversation and get notified (the author is skipped).
    fn mentions(&self, c: &Conversation, data: &Value, performer: &Performer) -> Result<()> {
        let repo = &self.core.repo;
        let (Some(message), Some(content)) = (data["id"].as_i64(), data["content"].as_str()) else {
            return Ok(());
        };
        for id in mentioned_user_ids(content) {
            if Some(id) == data["sender_id"].as_i64() {
                continue;
            }
            let reachable = match repo.user(id)? {
                Some(u) if u.is_active() => {
                    u.role == "administrator" || repo.member_inbox_ids(id)?.contains(&c.inbox_id)
                }
                _ => false,
            };
            if reachable && repo.add_mention(id, c.id, message, self.core.now())? {
                repo.add_participant(c.id, id)?;
                self.notify(id, "conversation_mention", c, Some(performer))?;
            }
        }
        Ok(())
    }

    pub fn list(&self, user: &User) -> Result<Value> {
        let now = self.core.now();
        Ok(json!({
            "items": self.core.repo.notifications(user.id, now, 50)?,
            "unread": self.core.repo.unread_notifications(user.id, now)?,
        }))
    }

    pub fn unread_count(&self, user: &User) -> Result<Value> {
        Ok(json!({ "unread": self.core.repo.unread_notifications(user.id, self.core.now())? }))
    }

    fn found(&self, user: &User, changed: usize) -> Result<Value> {
        if changed == 0 {
            return Err(HelpdeskError::not_found("Notificação não encontrada").into());
        }
        self.unread_count(user)
    }

    pub fn read(&self, user: &User, id: i64) -> Result<Value> {
        self.found(user, self.core.repo.read_notification(user.id, id, self.core.now())?)
    }

    pub fn mark_unread(&self, user: &User, id: i64) -> Result<Value> {
        self.found(user, self.core.repo.unread_notification(user.id, id)?)
    }

    /// Hides the notification until `until`, when it comes back unread.
    pub fn snooze(&self, user: &User, id: i64, until: i64) -> Result<Value> {
        if until <= self.core.now() {
            return fail("Escolha um horário no futuro");
        }
        self.found(user, self.core.repo.snooze_notification(user.id, id, until)?)
    }

    pub fn delete(&self, user: &User, id: i64) -> Result<Value> {
        self.found(user, self.core.repo.delete_notification(user.id, id)?)
    }

    pub fn delete_all(&self, user: &User) -> Result<Value> {
        self.core.repo.delete_all_notifications(user.id)?;
        Ok(json!({ "unread": 0 }))
    }

    /// Every notification type with its on/off state for the agent.
    pub fn settings(&self, user: &User) -> Result<Value> {
        let saved = self.core.repo.notification_settings(user.id)?;
        let flags: serde_json::Map<String, Value> = NOTIFICATION_TYPES
            .iter()
            .map(|kind| ((*kind).to_string(), Value::Bool(is_enabled(&saved, kind))))
            .collect();
        Ok(json!({ "flags": flags }))
    }

    pub fn update_settings(&self, user: &User, flags: &serde_json::Map<String, Value>) -> Result<Value> {
        let mut saved = self.core.repo.notification_settings(user.id)?;
        for (kind, enabled) in flags {
            let (true, Some(enabled)) = (NOTIFICATION_TYPES.contains(&kind.as_str()), enabled.as_bool()) else {
                return fail("Tipo de notificação inválido");
            };
            saved[kind.as_str()] = Value::Bool(enabled);
        }
        self.core.repo.set_notification_settings(user.id, &saved)?;
        self.settings(user)
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
