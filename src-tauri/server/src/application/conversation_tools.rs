//! Conversation tools from the chat list and header: mark unread, mute, participants, transcript
//! and deletion.
use super::helpdesk::HelpdeskService;
use crate::domain::actor::Actor;
use crate::domain::error::{fail_with, Result};
use crate::domain::helpdesk::require_admin;
use crate::domain::model::{Conversation, ConversationChanges as Changes, User};
use serde_json::json;

fn who(actor: &Actor) -> String {
    actor.name().unwrap_or_else(|| "Sistema".into())
}

impl HelpdeskService {
    /// Shows the unread badge again: "seen" moves to just before the latest contact message.
    pub fn mark_unread(&self, actor: &Actor, display_id: i64) -> Result<Conversation> {
        let conversation = self.core.load(Some(actor), display_id)?;
        let messages = self.core.repo.messages(conversation.id, None, 100)?;
        let last = messages
            .iter()
            .rev()
            .find(|m| m.message_type == "incoming")
            .map(|m| m.created_at - 1);
        let updated = self.core.update(
            conversation.id,
            Changes {
                agent_last_seen_at: Some(last),
                ..Default::default()
            },
        )?;
        self.core.emit("conversation.updated", &updated, Some(actor));
        Ok(updated)
    }

    /// Muted conversations are resolved and new contact messages no longer reopen or notify.
    pub fn set_muted(&self, actor: &Actor, display_id: i64, muted: bool) -> Result<Conversation> {
        let conversation = self.core.load(Some(actor), display_id)?;
        if (conversation.muted != 0) == muted {
            return Ok(conversation);
        }
        self.core.commit(Some(actor), |events| {
            let mut changes = Changes {
                muted: Some(muted),
                ..Default::default()
            };
            if muted && conversation.status != "resolved" {
                changes.status = Some("resolved".into());
                changes.snoozed_until = Some(None);
            }
            let updated = self.core.update(conversation.id, changes)?;
            let verb = if muted {
                "silenciou a"
            } else {
                "reativou as notificações da"
            };
            self.core
                .activity(&updated, format!("{} {verb} conversa", who(actor)), events)?;
            if muted && conversation.status != "resolved" {
                events.push("conversation.status_changed", &updated);
            }
            events.push("conversation.updated", &updated);
            Ok(updated)
        })
    }

    pub fn participants(&self, actor: &Actor, display_id: i64) -> Result<Vec<User>> {
        let conversation = self.core.load(Some(actor), display_id)?;
        let mut users = Vec::new();
        for id in self.core.repo.participant_ids(conversation.id)? {
            users.extend(self.core.repo.user(id)?);
        }
        users.sort_by_key(|u| u.name.to_lowercase());
        Ok(users)
    }

    /// Replaces the participants (agents who follow the conversation); they must reach its inbox.
    pub fn set_participants(&self, actor: &Actor, display_id: i64, user_ids: &[i64]) -> Result<Vec<User>> {
        let conversation = self.core.load(Some(actor), display_id)?;
        for id in user_ids {
            let allowed = match self.core.repo.user(*id)? {
                Some(user) if user.is_active() => {
                    user.role == "administrator"
                        || self
                            .core
                            .repo
                            .member_inbox_ids(user.id)?
                            .contains(&conversation.inbox_id)
                }
                _ => false,
            };
            if !allowed {
                return fail_with("Agente sem acesso a esta caixa de entrada", 422);
            }
        }
        for id in self.core.repo.participant_ids(conversation.id)? {
            if !user_ids.contains(&id) {
                self.core.repo.remove_participant(conversation.id, id)?;
            }
        }
        for id in user_ids {
            self.core.repo.add_participant(conversation.id, *id)?;
        }
        self.core.emit("conversation.updated", &conversation, Some(actor));
        self.participants(actor, display_id)
    }

    /// Plain-text transcript of the conversation (notes and activities excluded).
    pub fn transcript(&self, actor: &Actor, display_id: i64) -> Result<String> {
        let conversation = self.core.load(Some(actor), display_id)?;
        let contact = conversation.contact_name.clone().unwrap_or_else(|| "Contato".into());
        let mut lines = vec![format!(
            "Conversa #{} — {} ({})",
            conversation.display_id, contact, conversation.inbox_name
        )];
        let mut before = None;
        let mut pages = Vec::new();
        loop {
            let page = self.core.repo.messages(conversation.id, before, 100)?;
            let Some(first) = page.first() else { break };
            before = Some(first.id);
            let done = page.len() < 100;
            pages.push(page);
            if done {
                break;
            }
        }
        for message in pages.into_iter().rev().flatten() {
            if message.private || message.message_type == "activity" {
                continue;
            }
            let at = chrono::DateTime::from_timestamp(message.created_at, 0).unwrap_or_default();
            let author = match message.message_type.as_str() {
                "incoming" => contact.clone(),
                _ => message.sender_name.clone().unwrap_or_else(|| "Equipe".into()),
            };
            let mut text = message.content.clone().unwrap_or_default();
            for attachment in &message.attachments {
                let name = attachment
                    .file_name
                    .clone()
                    .unwrap_or_else(|| attachment.file_type.clone());
                text.push_str(&format!(" [anexo: {name}]"));
            }
            lines.push(format!("[{}] {author}: {}", at.format("%d/%m/%Y %H:%M"), text.trim()));
        }
        Ok(lines.join("\n") + "\n")
    }

    /// Administrators may delete a conversation and its messages.
    pub fn delete_conversation(&self, actor: &Actor, display_id: i64) -> Result<()> {
        require_admin(actor)?;
        let conversation = self.core.load(Some(actor), display_id)?;
        self.core.repo.delete_conversation(conversation.id)?;
        let data =
            json!({ "id": conversation.id, "display_id": conversation.display_id, "inbox_id": conversation.inbox_id });
        self.core.emit("conversation.deleted", &data, Some(actor));
        Ok(())
    }
}
