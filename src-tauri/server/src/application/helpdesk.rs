//! Conversation use cases. The actor is an agent, the MCP bot of an inbox or an automation;
//! bots only reach their own inbox and reply as `agent_bot`.
use super::core::{Core, Events};
use super::ports::{HistoryPage, WhatsApp};
use crate::domain::actor::Actor;
use crate::domain::error::{Error, HelpdeskError, Result};
use crate::domain::helpdesk::assignment_activity;
use crate::domain::model::{
    Contact, ContactChanges, Conversation, ConversationChanges as Changes, ConversationCounts,
    ConversationFilters, Inbox, Message, MirrorMessage, NewMessage,
};
use serde::Serialize;
use serde_json::json;
use std::sync::Arc;

#[derive(Clone)]
pub struct HelpdeskService {
    pub core: Core,
    pub whatsapp: Arc<dyn WhatsApp>,
}

/// A contact with the conversations the actor may see.
#[derive(Debug, Serialize)]
pub struct ContactDetail {
    #[serde(flatten)]
    pub contact: Contact,
    pub conversations: Vec<Conversation>,
}

/// The message shown to users when WhatsApp rejects a send.
fn failure_text(error: &Error) -> String {
    match error {
        Error::Helpdesk(e) => e.message.clone(),
        Error::Internal(_) => "Falha no envio".into(),
    }
}

impl HelpdeskService {
    pub fn bot_for(&self, session_id: &str) -> Result<Actor> {
        let inbox = self
            .core
            .repo
            .inbox_for_session(session_id)?
            .ok_or_else(|| Error::from(HelpdeskError::not_found("Sessão não encontrada")))?;
        Ok(Actor::Bot { inbox_id: inbox.id })
    }

    fn scoped(&self, actor: &Actor, mut filters: ConversationFilters) -> Result<ConversationFilters> {
        filters.user_id = actor.user_id();
        filters.visible_inbox_ids = self.core.visible_inbox_ids(actor)?;
        Ok(filters)
    }

    pub fn conversations(&self, actor: &Actor, filters: ConversationFilters) -> Result<Vec<Conversation>> {
        self.core.repo.conversations(&self.scoped(actor, filters)?)
    }

    pub fn meta(&self, actor: &Actor, filters: ConversationFilters) -> Result<ConversationCounts> {
        self.core.repo.conversation_counts(&self.scoped(actor, filters)?)
    }

    pub fn conversation(&self, actor: &Actor, display_id: i64) -> Result<Conversation> {
        self.core.load(Some(actor), display_id)
    }

    pub fn messages(&self, actor: &Actor, display_id: i64, before: Option<i64>, limit: i64) -> Result<Vec<Message>> {
        let conversation = self.core.load(Some(actor), display_id)?;
        self.core.repo.messages(conversation.id, before, limit)
    }

    /// Older WhatsApp history for the contact, read from the local mirror.
    pub fn history(&self, actor: &Actor, display_id: i64, page: &HistoryPage) -> Result<Vec<MirrorMessage>> {
        let conversation = self.core.load(Some(actor), display_id)?;
        let inbox = self.core.inbox(conversation.inbox_id)?;
        self.core
            .repo
            .mirror_messages(&inbox.session_id, &conversation.contact_jid, page)
    }

    pub fn mark_seen(&self, actor: &Actor, display_id: i64) -> Result<Conversation> {
        let conversation = self.core.load(Some(actor), display_id)?;
        let now = self.core.now();
        self.core.update(
            conversation.id,
            Changes {
                agent_last_seen_at: Some(Some(now)),
                ..Default::default()
            },
        )
    }

    /// Agent, bot or automation reply; automated messages carry their origin in content_attributes.
    pub async fn reply(&self, actor: &Actor, display_id: i64, content: &str, private: bool) -> Result<Message> {
        let conversation = self.core.load(Some(actor), display_id)?;
        let inbox = self.core.inbox(conversation.inbox_id)?;
        let message = self
            .core
            .commit(Some(actor), |events| self.store_reply(actor, &conversation, content, private, events))?;
        if private {
            return Ok(message);
        }
        self.deliver(message, &inbox, &conversation, actor).await
    }

    fn store_reply(
        &self,
        actor: &Actor,
        conversation: &Conversation,
        content: &str,
        private: bool,
        events: &mut Events,
    ) -> Result<Message> {
        let core = &self.core;
        let attributes = match actor {
            Actor::System { name, .. } => json!({ "automated": name }),
            _ => json!({}),
        };
        let stored = core
            .repo
            .insert_message(&NewMessage {
                conversation_id: conversation.id,
                inbox_id: conversation.inbox_id,
                message_type: "outgoing".into(),
                content: Some(content.into()),
                private,
                status: Some(if private { "sent" } else { "pending" }.into()),
                sender_type: Some(actor.sender_type().into()),
                sender_id: actor.user_id(),
                source_id: (!private).then(|| self.whatsapp.new_message_id()),
                wa_jid: (!private).then(|| conversation.contact_jid.clone()),
                content_attributes: attributes,
                created_at: core.now(),
                ..NewMessage::default()
            })?
            .ok_or_else(|| Error::internal("duplicate outgoing message id"))?;
        if let Some(id) = actor.user_id() {
            core.repo.add_participant(conversation.id, id)?;
        }
        events.push("message.created", &stored);
        if private {
            return Ok(stored);
        }
        let now = core.now();
        // Greetings, out-of-office and surveys must not count as the team's first reply.
        if matches!(actor, Actor::System { .. }) {
            core.update(conversation.id, Changes { last_activity_at: Some(now), ..Default::default() })?;
            return Ok(stored);
        }
        let updated = core.update(
            conversation.id,
            Changes {
                last_activity_at: Some(now),
                waiting_since: Some(None),
                first_reply_at: Some(Some(conversation.first_reply_at.unwrap_or(now))),
                ..Default::default()
            },
        )?;
        // Like Chatwoot, an agent replying to an unassigned conversation takes it.
        if updated.assignee_id.is_none() && actor.is_agent() && !actor.is_admin() {
            let taken = core.update(
                conversation.id,
                Changes { assignee_id: Some(actor.user_id()), ..Default::default() },
            )?;
            let name = actor.name();
            core.activity(&taken, assignment_activity(name.as_deref(), name.as_deref()), events)?;
            events.push("assignee.changed", &taken);
        }
        Ok(stored)
    }

    async fn deliver(&self, message: Message, inbox: &Inbox, conversation: &Conversation, actor: &Actor) -> Result<Message> {
        let repo = &self.core.repo;
        let content = message.content.clone().unwrap_or_default();
        let sent = self
            .whatsapp
            .send(&inbox.session_id, &conversation.contact_jid, &content, message.source_id.as_deref())
            .await;
        let updated = match sent {
            Ok(_) => {
                let current = repo.message(message.id)?.unwrap_or(message);
                // A delivery receipt may already have advanced the status while the send was in flight.
                if current.status != "pending" {
                    return Ok(current);
                }
                repo.update_message(current.id, Some("sent"), None)?
            }
            Err(error) => {
                let attributes = json!({ "external_error": failure_text(&error) });
                repo.update_message(message.id, Some("failed"), Some(&attributes))?
            }
        };
        self.core.emit("message.updated", &updated, Some(actor));
        Ok(updated)
    }

    pub fn contacts(&self, q: &str, page: i64) -> Result<Vec<Contact>> {
        self.core.repo.contacts(q, page)
    }

    pub fn contact(&self, actor: &Actor, id: i64) -> Result<ContactDetail> {
        let contact = self.find_contact(id)?;
        let visible = self.core.visible_inbox_ids(actor)?;
        let conversations = self.core.repo.contact_conversations(id, visible.as_deref())?;
        Ok(ContactDetail { contact, conversations })
    }

    pub fn update_contact(&self, actor: &Actor, id: i64, changes: &ContactChanges) -> Result<Contact> {
        self.find_contact(id)?;
        let updated = self.core.repo.update_contact(id, changes)?;
        self.core.emit("contact.updated", &updated, Some(actor));
        Ok(updated)
    }

    fn find_contact(&self, id: i64) -> Result<Contact> {
        self.core
            .repo
            .contact(id)?
            .ok_or_else(|| HelpdeskError::not_found("Contato não encontrado").into())
    }
}
