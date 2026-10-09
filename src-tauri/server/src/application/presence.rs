//! Typing indicators in both directions and read receipts for messages the agent has seen.
use super::helpdesk::HelpdeskService;
use super::ports::Typing;
use crate::domain::actor::Actor;
use crate::domain::error::{fail, Result};
use crate::domain::model::Conversation;
use serde_json::json;

fn event_name(state: Typing) -> &'static str {
    match state {
        Typing::Paused => "conversation.typing_off",
        _ => "conversation.typing_on",
    }
}

fn payload(conversation: &Conversation, state: Typing, user: serde_json::Value, private: bool) -> serde_json::Value {
    json!({
        "id": conversation.id,
        "display_id": conversation.display_id,
        "inbox_id": conversation.inbox_id,
        "recording": state == Typing::Recording,
        "is_private": private,
        "user": user,
    })
}

impl HelpdeskService {
    /// The contact is typing: agents viewing the conversation see "digitando…".
    pub fn contact_typing(&self, session_id: &str, jid: &str, state: Typing) -> Result<()> {
        let repo = &self.core.repo;
        let Some(inbox) = repo.inbox_for_session(session_id)? else {
            return Ok(());
        };
        let Some(contact_inbox) = repo.contact_inbox(inbox.id, jid)? else {
            return Ok(());
        };
        let Some(conversation) = repo
            .latest_conversation(contact_inbox.id)?
            .filter(|c| c.status != "resolved")
        else {
            return Ok(());
        };
        let user = json!({ "type": "contact", "id": conversation.contact_id, "name": conversation.contact_name });
        let data = payload(&conversation, state, user, false);
        self.core.emit(event_name(state), &data, Some(&Actor::contact()));
        Ok(())
    }

    /// The agent is typing: shown to the contact (unless writing a private note) and to other agents.
    pub async fn agent_typing(&self, actor: &Actor, display_id: i64, status: &str, private: bool) -> Result<()> {
        let state = match status {
            "on" => Typing::Composing,
            "recording" => Typing::Recording,
            "off" => Typing::Paused,
            _ => return fail("Estado de digitação inválido"),
        };
        let conversation = self.core.load(Some(actor), display_id)?;
        if !private {
            let inbox = self.core.inbox(conversation.inbox_id)?;
            // Best effort: a disconnected session must not break the composer.
            let _ = self
                .whatsapp
                .typing(&inbox.session_id, &conversation.contact_jid, state)
                .await;
        }
        let user = json!({ "type": "user", "id": actor.user_id(), "name": actor.name() });
        self.core.emit(
            event_name(state),
            &payload(&conversation, state, user, private),
            Some(actor),
        );
        Ok(())
    }

    /// Blue ticks for the contact: incoming messages the agent has just seen are marked read.
    pub async fn send_read_receipts(&self, actor: &Actor, display_id: i64, seen_before: Option<i64>) -> Result<()> {
        let conversation = self.core.load(Some(actor), display_id)?;
        let since = seen_before.unwrap_or(0);
        let messages = self.core.repo.messages(conversation.id, None, 100)?;
        let unread: Vec<String> = messages
            .iter()
            .filter(|m| m.message_type == "incoming" && m.created_at > since)
            .filter_map(|m| m.source_id.clone())
            .collect();
        if unread.is_empty() {
            return Ok(());
        }
        let inbox = self.core.inbox(conversation.inbox_id)?;
        self.whatsapp
            .mark_read(&inbox.session_id, &conversation.contact_jid, &unread)
            .await
    }
}
