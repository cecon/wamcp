//! Conversation use cases. The actor is an agent, the MCP bot of an inbox or an automation;
//! bots only reach their own inbox and reply as `agent_bot`.
use super::core::{Core, Events};
use super::ports::{HistoryPage, WhatsApp};
use crate::domain::actor::Actor;
use crate::domain::error::{fail, fail_with, Error, HelpdeskError, Result};
use crate::domain::helpdesk::{
    assignment_activity, labels_activity, normalize_label_title, status_activity, team_activity,
    validate_status_change, PRIORITIES,
};
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

    pub fn toggle_status(&self, actor: &Actor, display_id: i64, status: &str, snoozed_until: Option<i64>) -> Result<Conversation> {
        let conversation = self.core.load(Some(actor), display_id)?;
        validate_status_change(status, snoozed_until, self.core.now())?;
        if conversation.status == status && status != "snoozed" {
            return Ok(conversation);
        }
        self.core.commit(Some(actor), |events| {
            let mut updated = self.core.update(
                conversation.id,
                Changes {
                    status: Some(status.into()),
                    snoozed_until: Some(snoozed_until.filter(|_| status == "snoozed")),
                    ..Default::default()
                },
            )?;
            self.core.activity(&updated, status_activity(actor.name().as_deref(), status), events)?;
            events.push("conversation.status_changed", &updated);
            if conversation.status == "pending" && status == "open" {
                events.push("conversation.bot_handoff", &updated);
            }
            if status == "open" {
                updated = self.core.auto_assign(updated, events)?;
            }
            Ok(updated)
        })
    }

    /// `None` leaves the field untouched; `Some(None)` removes the assignee or team.
    pub fn assign(&self, actor: &Actor, display_id: i64, assignee: Option<Option<i64>>, team: Option<Option<i64>>) -> Result<Conversation> {
        let conversation = self.core.load(Some(actor), display_id)?;
        let (core, name) = (&self.core, actor.name());
        core.commit(Some(actor), |events| {
            let mut updated = conversation.clone();
            if let Some(team_id) = team.filter(|t| *t != conversation.team_id) {
                if let Some(id) = team_id {
                    if core.repo.team(id)?.is_none() {
                        return fail_with("Time não encontrado", 404);
                    }
                }
                updated = core.update(conversation.id, Changes { team_id: Some(team_id), ..Default::default() })?;
                core.activity(&updated, team_activity(name.as_deref(), updated.team_name.as_deref()), events)?;
                events.push("team.changed", &updated);
            }
            match assignee {
                Some(assignee_id) if assignee_id != conversation.assignee_id => {
                    if let Some(id) = assignee_id {
                        self.require_assignable(id, conversation.inbox_id)?;
                        core.repo.add_participant(conversation.id, id)?;
                    }
                    updated = core.update(conversation.id, Changes { assignee_id: Some(assignee_id), ..Default::default() })?;
                    let assignee_name = updated.assignee_name.clone();
                    core.activity(&updated, assignment_activity(name.as_deref(), assignee_name.as_deref()), events)?;
                    events.push("assignee.changed", &updated);
                }
                None if matches!(team, Some(Some(_))) => updated = core.auto_assign(updated, events)?,
                _ => {}
            }
            Ok(updated)
        })
    }

    fn require_assignable(&self, user_id: i64, inbox_id: i64) -> Result<()> {
        let repo = &self.core.repo;
        let assignee = repo.user(user_id)?;
        let allowed = match &assignee {
            Some(user) if user.is_active() => {
                user.role == "administrator" || repo.member_inbox_ids(user.id)?.contains(&inbox_id)
            }
            _ => false,
        };
        if allowed {
            Ok(())
        } else {
            fail_with("Agente sem acesso a esta caixa de entrada", 422)
        }
    }

    /// Replaces the conversation labels; every title must be an existing label.
    pub fn set_labels(&self, actor: &Actor, display_id: i64, titles: &[String]) -> Result<Conversation> {
        let conversation = self.core.load(Some(actor), display_id)?;
        let mut wanted: Vec<String> = Vec::new();
        for title in titles {
            let slug = normalize_label_title(title)?;
            if !wanted.contains(&slug) {
                wanted.push(slug);
            }
        }
        let labels = if wanted.is_empty() { Vec::new() } else { self.core.repo.labels_by_titles(&wanted)? };
        let missing: Vec<&str> = wanted
            .iter()
            .filter(|t| !labels.iter().any(|l| l.title.to_lowercase() == **t))
            .map(String::as_str)
            .collect();
        if !missing.is_empty() {
            return fail_with(format!("Etiqueta inexistente: {}", missing.join(", ")), 422);
        }
        let next: Vec<String> = labels.iter().map(|l| l.title.clone()).collect();
        let added: Vec<String> = next.iter().filter(|t| !conversation.labels.contains(t)).cloned().collect();
        let removed: Vec<String> = conversation.labels.iter().filter(|t| !next.contains(t)).cloned().collect();
        if added.is_empty() && removed.is_empty() {
            return Ok(conversation);
        }
        let ids: Vec<i64> = labels.iter().map(|l| l.id).collect();
        self.core.commit(Some(actor), |events| {
            let updated = self.core.repo.set_conversation_labels(conversation.id, &ids)?;
            self.core.activity(&updated, labels_activity(actor.name().as_deref(), &added, &removed), events)?;
            events.push("conversation.updated", &updated);
            Ok(updated)
        })
    }

    pub fn set_priority(&self, actor: &Actor, display_id: i64, priority: Option<&str>) -> Result<Conversation> {
        let conversation = self.core.load(Some(actor), display_id)?;
        if priority.is_some_and(|p| !PRIORITIES.contains(&p)) {
            return fail("Prioridade inválida");
        }
        if conversation.priority.as_deref() == priority {
            return Ok(conversation);
        }
        self.core.commit(Some(actor), |events| {
            let changes = Changes { priority: Some(priority.map(String::from)), ..Default::default() };
            let updated = self.core.update(conversation.id, changes)?;
            events.push("conversation.updated", &updated);
            Ok(updated)
        })
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
