//! Actions on existing messages, from agents and from WhatsApp: reactions, deletions, edits,
//! quotes and retries of failed sends.
use super::helpdesk::HelpdeskService;
use super::ports::{MessageRef, Quote, SendRequest};
use crate::domain::actor::Actor;
use crate::domain::error::{fail, fail_with, HelpdeskError, Result};
use crate::domain::model::{Conversation, Inbox, Message, OutgoingMedia};
use serde_json::{json, Value};

fn attributes(message: &Message) -> Value {
    if message.content_attributes.is_object() {
        message.content_attributes.clone()
    } else {
        json!({})
    }
}

/// Replaces the sender's reaction (one per sender); an empty emoji removes it.
pub fn with_reaction(
    message: &Message,
    sender_type: &str,
    sender_id: Option<i64>,
    name: Option<String>,
    emoji: &str,
) -> Value {
    let mut attributes = attributes(message);
    let mut reactions: Vec<Value> = attributes["reactions"].as_array().cloned().unwrap_or_default();
    reactions.retain(|r| !(r["sender_type"] == sender_type && r["sender_id"].as_i64() == sender_id));
    if !emoji.is_empty() {
        reactions
            .push(json!({ "emoji": emoji, "sender_type": sender_type, "sender_id": sender_id, "sender_name": name }));
    }
    attributes["reactions"] = Value::Array(reactions);
    attributes
}

impl HelpdeskService {
    /// A message of the conversation (404 when it belongs elsewhere).
    pub(crate) fn conversation_message(&self, conversation: &Conversation, id: i64) -> Result<Message> {
        self.core
            .repo
            .message(id)?
            .filter(|m| m.conversation_id == conversation.id)
            .ok_or_else(|| HelpdeskError::not_found("Mensagem não encontrada").into())
    }

    fn by_source(&self, session_id: &str, source_id: &str) -> Result<Option<(Inbox, Message)>> {
        let Some(inbox) = self.core.repo.inbox_for_session(session_id)? else {
            return Ok(None);
        };
        let message = self.core.repo.message_by_source(inbox.id, source_id)?;
        Ok(message.map(|m| (inbox, m)))
    }

    fn changed(
        &self,
        message: &Message,
        content: Option<Option<&str>>,
        attributes: &Value,
        actor: Option<&Actor>,
    ) -> Result<Message> {
        let repo = &self.core.repo;
        if let Some(content) = content {
            repo.set_message_content(message.id, content)?;
        }
        let updated = repo.update_message(message.id, None, Some(attributes))?;
        self.core.emit("message.updated", &updated, actor);
        Ok(updated)
    }

    pub fn incoming_quote(&self, session_id: &str, message_id: &str, quoted_id: &str) -> Result<()> {
        let (Some((_, message)), Some((_, quoted))) = (
            self.by_source(session_id, message_id)?,
            self.by_source(session_id, quoted_id)?,
        ) else {
            return Ok(());
        };
        let mut attributes = attributes(&message);
        attributes["in_reply_to"] = json!(quoted.id);
        attributes["in_reply_to_external_id"] = json!(quoted_id);
        self.changed(&message, None, &attributes, None).map(drop)
    }

    pub fn incoming_reaction(
        &self,
        session_id: &str,
        _jid: &str,
        from_me: bool,
        target_id: &str,
        emoji: &str,
    ) -> Result<()> {
        let Some((_, message)) = self.by_source(session_id, target_id)? else {
            return Ok(());
        };
        let conversation = self.core.repo.conversation_by_id(message.conversation_id)?;
        let (kind, id, name) = if from_me {
            ("user", None, Some("Celular".to_string()))
        } else {
            (
                "contact",
                conversation.as_ref().map(|c| c.contact_id),
                conversation.and_then(|c| c.contact_name),
            )
        };
        let attributes = with_reaction(&message, kind, id, name, emoji);
        self.changed(&message, None, &attributes, None).map(drop)
    }

    pub fn incoming_revoke(&self, session_id: &str, target_id: &str) -> Result<()> {
        let Some((_, message)) = self.by_source(session_id, target_id)? else {
            return Ok(());
        };
        let mut attributes = attributes(&message);
        attributes["deleted"] = json!(true);
        self.changed(&message, Some(None), &attributes, None).map(drop)
    }

    pub fn incoming_edit(&self, session_id: &str, target_id: &str, text: &str) -> Result<()> {
        let Some((_, message)) = self.by_source(session_id, target_id)? else {
            return Ok(());
        };
        let mut attributes = attributes(&message);
        attributes["edited"] = json!(true);
        attributes["previous_content"] = json!(message.content);
        self.changed(&message, Some(Some(text)), &attributes, None).map(drop)
    }

    /// The agent reacts to a message; the reaction also appears on the contact's phone.
    pub async fn react(&self, actor: &Actor, display_id: i64, message_id: i64, emoji: &str) -> Result<Message> {
        let conversation = self.core.load(Some(actor), display_id)?;
        let message = self.conversation_message(&conversation, message_id)?;
        if emoji.chars().count() > 8 {
            return fail("Reação inválida");
        }
        if let Some(source_id) = &message.source_id {
            let inbox = self.core.inbox(conversation.inbox_id)?;
            let target = MessageRef {
                id: source_id.clone(),
                from_me: message.message_type == "outgoing",
            };
            self.whatsapp
                .react(&inbox.session_id, &conversation.contact_jid, &target, emoji)
                .await?;
        }
        let attributes = with_reaction(&message, "user", actor.user_id(), actor.name(), emoji);
        self.changed(&message, None, &attributes, Some(actor))
    }

    /// Deletes an outgoing message (for everyone on WhatsApp) or a private note.
    pub async fn delete_message(&self, actor: &Actor, display_id: i64, message_id: i64) -> Result<Message> {
        let conversation = self.core.load(Some(actor), display_id)?;
        let message = self.conversation_message(&conversation, message_id)?;
        if message.message_type != "outgoing" {
            return fail_with("Só é possível apagar mensagens enviadas pela equipe", 422);
        }
        if let (Some(source_id), false, false) = (&message.source_id, message.private, message.status == "failed") {
            let inbox = self.core.inbox(conversation.inbox_id)?;
            self.whatsapp
                .revoke(&inbox.session_id, &conversation.contact_jid, source_id)
                .await?;
        }
        let mut attributes = attributes(&message);
        attributes["deleted"] = json!(true);
        self.changed(&message, Some(None), &attributes, Some(actor))
    }

    /// Sends a failed message again (same WhatsApp id, so the contact never gets it twice).
    pub async fn retry(&self, actor: &Actor, display_id: i64, message_id: i64) -> Result<Message> {
        let conversation = self.core.load(Some(actor), display_id)?;
        let message = self.conversation_message(&conversation, message_id)?;
        if message.status != "failed" || message.private || message.source_id.is_none() {
            return fail_with("Só mensagens com falha no envio podem ser reenviadas", 422);
        }
        let inbox = self.core.inbox(conversation.inbox_id)?;
        let media = match message.attachments.first() {
            Some(attachment) => {
                let source = self.core.repo.attachment_source(attachment.id)?;
                let bytes = match source.and_then(|s| s.path) {
                    Some(path) => self.storage.read(&path)?.unwrap_or_default(),
                    None => Vec::new(),
                };
                Some(OutgoingMedia {
                    file_type: attachment.file_type.clone(),
                    mime_type: attachment.mime_type.clone(),
                    file_name: attachment.file_name.clone(),
                    caption: message.content.clone(),
                    voice: attachment.voice,
                    seconds: attachment.duration,
                    bytes,
                })
            }
            None => None,
        };
        let quote = match message.content_attributes["in_reply_to"].as_i64() {
            Some(id) => self.conversation_message(&conversation, id).ok().and_then(|q| {
                let text = q.content.clone().unwrap_or_default();
                q.source_id.map(|id| Quote {
                    id,
                    from_me: q.message_type == "outgoing",
                    text,
                })
            }),
            None => None,
        };
        let mut attributes = attributes(&message);
        if let Some(map) = attributes.as_object_mut() {
            map.remove("external_error");
        }
        let pending = self
            .core
            .repo
            .update_message(message.id, Some("pending"), Some(&attributes))?;
        let request = SendRequest {
            jid: conversation.contact_jid.clone(),
            text: message.content.clone(),
            media,
            quote,
            message_id: message.source_id.clone(),
        };
        self.deliver(pending, &inbox, request, actor).await
    }
}
