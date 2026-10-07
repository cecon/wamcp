//! Conversation use cases. The actor is an agent, the MCP bot of an inbox or an automation;
//! bots only reach their own inbox and reply as `agent_bot`.
use super::core::Core;
use super::ports::{HistoryPage, MediaStorage, WhatsApp};
use crate::domain::actor::Actor;
use crate::domain::error::{Error, HelpdeskError, Result};
use crate::domain::model::{
    Contact, ContactChanges, Conversation, ConversationChanges as Changes, ConversationCounts, ConversationFilters,
    Message, MirrorMessage,
};
use serde::Serialize;
use std::sync::Arc;

#[derive(Clone)]
pub struct HelpdeskService {
    pub core: Core,
    pub whatsapp: Arc<dyn WhatsApp>,
    pub storage: Arc<dyn MediaStorage>,
}

/// A contact with the conversations the actor may see.
#[derive(Debug, Serialize)]
pub struct ContactDetail {
    #[serde(flatten)]
    pub contact: Contact,
    pub conversations: Vec<Conversation>,
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
