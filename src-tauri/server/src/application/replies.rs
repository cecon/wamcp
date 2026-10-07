//! Outgoing messages: text, files and voice notes, optionally answering (quoting) another message.
//! Agent, bot or automation replies; automated messages carry their origin in content_attributes.
use super::core::Events;
use super::helpdesk::HelpdeskService;
use super::ports::{Quote, SendRequest};
use crate::domain::actor::Actor;
use crate::domain::error::{fail, Error, HelpdeskError, Result};
use crate::domain::helpdesk::assignment_activity;
use crate::domain::media::{extension, storage_path, validate_upload};
use crate::domain::model::{
    Conversation, ConversationChanges as Changes, Inbox, Message, NewAttachment, NewMessage, OutgoingMedia, Upload,
};
use serde_json::{json, Value};

/// What an agent (or bot, or automation) sends.
#[derive(Debug, Clone, Default)]
pub struct Draft {
    pub content: Option<String>,
    pub private: bool,
    pub upload: Option<Upload>,
    /// The support message being answered (`in_reply_to`).
    pub in_reply_to: Option<i64>,
}

/// The message shown to users when WhatsApp rejects a send.
fn failure_text(error: &Error) -> String {
    match error {
        Error::Helpdesk(e) => e.message.clone(),
        Error::Internal(_) => "Falha no envio".into(),
    }
}

/// A stored file ready to be attached and sent.
struct Prepared {
    attachment: NewAttachment,
    media: OutgoingMedia,
}

impl HelpdeskService {
    pub async fn reply(&self, actor: &Actor, display_id: i64, content: &str, private: bool) -> Result<Message> {
        let draft = Draft {
            content: Some(content.into()),
            private,
            ..Draft::default()
        };
        self.send_draft(actor, display_id, draft).await
    }

    pub async fn send_draft(&self, actor: &Actor, display_id: i64, draft: Draft) -> Result<Message> {
        let conversation = self.core.load(Some(actor), display_id)?;
        let inbox = self.core.inbox(conversation.inbox_id)?;
        let content = draft.content.clone().filter(|c| !c.trim().is_empty());
        if content.is_none() && draft.upload.is_none() {
            return fail("Escreva uma mensagem ou anexe um arquivo");
        }
        let quoted = match draft.in_reply_to {
            Some(id) => Some(self.quoted(&conversation, id)?),
            None => None,
        };
        let source_id = (!draft.private).then(|| self.whatsapp.new_message_id());
        let file_id = source_id
            .clone()
            .unwrap_or_else(|| format!("note-{}", uuid::Uuid::new_v4().simple()));
        let prepared = match draft.upload {
            Some(upload) => Some(self.store_upload(&inbox, &file_id, upload, content.clone())?),
            None => None,
        };
        let mut attributes = match actor {
            Actor::System { name, .. } => json!({ "automated": name }),
            _ => json!({}),
        };
        if let Some(q) = &quoted {
            attributes["in_reply_to"] = json!(q.id);
            attributes["in_reply_to_external_id"] = json!(q.source_id);
        }
        let new = NewMessage {
            conversation_id: conversation.id,
            inbox_id: conversation.inbox_id,
            message_type: "outgoing".into(),
            content: content.clone(),
            content_type: prepared.as_ref().map(|p| p.media.file_type.clone()),
            private: draft.private,
            status: Some(if draft.private { "sent" } else { "pending" }.into()),
            sender_type: Some(actor.sender_type().into()),
            sender_id: actor.user_id(),
            source_id: source_id.clone(),
            wa_jid: (!draft.private).then(|| conversation.contact_jid.clone()),
            content_attributes: attributes,
            created_at: self.core.now(),
        };
        let attachment = prepared.as_ref().map(|p| p.attachment.clone());
        let message = self.core.commit(Some(actor), |events| {
            self.store_reply(actor, &conversation, &new, attachment, events)
        })?;
        if draft.private {
            return Ok(message);
        }
        let request = SendRequest {
            jid: conversation.contact_jid.clone(),
            text: content,
            media: prepared.map(|p| p.media),
            quote: quoted.and_then(|q| q.quote),
            message_id: source_id,
        };
        self.deliver(message, &inbox, request, actor).await
    }

    /// Validates the file and stores it under `media/<session>/<YYYY>/<MM>/`.
    fn store_upload(&self, inbox: &Inbox, file_id: &str, upload: Upload, caption: Option<String>) -> Result<Prepared> {
        let size = upload.bytes.len() as u64;
        let file_type = validate_upload(&upload.mime_type, size)?;
        let voice = upload.voice && file_type == "audio";
        let path = storage_path(
            &inbox.session_id,
            self.core.now(),
            file_id,
            &extension(&upload.mime_type, upload.file_name.as_deref()),
        );
        self.storage.save(&path, &upload.bytes)?;
        let attachment = NewAttachment {
            message_id: 0,
            file_type: file_type.into(),
            mime_type: upload.mime_type.clone(),
            file_name: upload.file_name.clone(),
            file_size: Some(size as i64),
            duration: None,
            voice,
            path: Some(path),
        };
        let media = OutgoingMedia {
            file_type: file_type.into(),
            mime_type: upload.mime_type,
            file_name: upload.file_name,
            caption,
            voice,
            seconds: None,
            bytes: upload.bytes,
        };
        Ok(Prepared { attachment, media })
    }

    fn store_reply(
        &self,
        actor: &Actor,
        conversation: &Conversation,
        new: &NewMessage,
        attachment: Option<NewAttachment>,
        events: &mut Events,
    ) -> Result<Message> {
        let core = &self.core;
        let mut stored = core
            .repo
            .insert_message(new)?
            .ok_or_else(|| Error::internal("duplicate outgoing message id"))?;
        if let Some(attachment) = attachment {
            core.repo.insert_attachment(&NewAttachment {
                message_id: stored.id,
                ..attachment
            })?;
            stored = core.repo.message(stored.id)?.unwrap_or(stored);
        }
        if let Some(id) = actor.user_id() {
            core.repo.add_participant(conversation.id, id)?;
        }
        events.push("message.created", &stored);
        if new.private {
            return Ok(stored);
        }
        let now = core.now();
        // Greetings, out-of-office and surveys must not count as the team's first reply.
        if matches!(actor, Actor::System { .. }) {
            core.update(
                conversation.id,
                Changes {
                    last_activity_at: Some(now),
                    ..Default::default()
                },
            )?;
            return Ok(stored);
        }
        let changes = Changes {
            last_activity_at: Some(now),
            waiting_since: Some(None),
            first_reply_at: Some(Some(conversation.first_reply_at.unwrap_or(now))),
            ..Default::default()
        };
        let updated = core.update(conversation.id, changes)?;
        // Like Chatwoot, an agent replying to an unassigned conversation takes it.
        if updated.assignee_id.is_none() && actor.is_agent() && !actor.is_admin() {
            let changes = Changes {
                assignee_id: Some(actor.user_id()),
                ..Default::default()
            };
            let taken = core.update(conversation.id, changes)?;
            let name = actor.name();
            core.activity(&taken, assignment_activity(name.as_deref(), name.as_deref()), events)?;
            events.push("assignee.changed", &taken);
        }
        Ok(stored)
    }

    pub(crate) async fn deliver(
        &self,
        message: Message,
        inbox: &Inbox,
        request: SendRequest,
        actor: &Actor,
    ) -> Result<Message> {
        let repo = &self.core.repo;
        let updated = match self.whatsapp.send_message(&inbox.session_id, &request).await {
            Ok(_) => {
                let current = repo.message(message.id)?.unwrap_or(message);
                // A delivery receipt may already have advanced the status while the send was in flight.
                if current.status != "pending" {
                    return Ok(current);
                }
                repo.update_message(current.id, Some("sent"), None)?
            }
            Err(error) => {
                let mut attributes = message.content_attributes.clone();
                if !attributes.is_object() {
                    attributes = json!({});
                }
                attributes["external_error"] = Value::String(failure_text(&error));
                repo.update_message(message.id, Some("failed"), Some(&attributes))?
            }
        };
        self.core.emit("message.updated", &updated, Some(actor));
        Ok(updated)
    }

    /// The answered message, which must belong to the same conversation.
    fn quoted(&self, conversation: &Conversation, id: i64) -> Result<QuotedMessage> {
        let message = self
            .core
            .repo
            .message(id)?
            .filter(|m| m.conversation_id == conversation.id);
        let Some(message) = message else {
            return Err(HelpdeskError::with_status("Mensagem citada não encontrada", 422).into());
        };
        let quote = message.source_id.clone().map(|id| Quote {
            id,
            from_me: message.message_type == "outgoing",
            text: message.content.clone().unwrap_or_default(),
        });
        Ok(QuotedMessage {
            id: message.id,
            source_id: message.source_id,
            quote,
        })
    }
}

struct QuotedMessage {
    id: i64,
    source_id: Option<String>,
    quote: Option<Quote>,
}
