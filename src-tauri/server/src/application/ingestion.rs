//! WhatsApp → helpdesk: live messages, CSAT answers, delivery receipts and snooze wake-ups.
use super::core::Events;
use super::helpdesk::HelpdeskService;
use crate::domain::actor::Actor;
use crate::domain::csat::{awaiting_csat, parse_rating};
use crate::domain::error::Result;
use crate::domain::helpdesk::{
    initial_status, is_support_jid, phone_from_jid, route_incoming, route_own_message, Route,
};
use crate::domain::model::{
    ContactChanges, ContactInbox, Conversation, ConversationChanges as Changes, CsatResponse, Inbox, Message,
    NewAttachment, NewMessage, WaMessage,
};
use serde_json::json;

const TEXT_KINDS: [&str; 2] = ["conversation", "extendedTextMessage"];

fn receipt_rank(status: &str) -> i64 {
    match status {
        "sent" => 1,
        "delivered" => 2,
        "read" => 3,
        _ => 0,
    }
}

impl HelpdeskService {
    fn contact_inbox_for(&self, inbox: &Inbox, d: &WaMessage, events: &mut Events) -> Result<Option<ContactInbox>> {
        let repo = &self.core.repo;
        if let Some(existing) = repo.contact_inbox(inbox.id, &d.jid)? {
            return Ok(Some(existing));
        }
        if d.from_me {
            return Ok(None);
        }
        let phone = phone_from_jid(Some(&d.jid)).or_else(|| phone_from_jid(d.alt_jid.as_deref()));
        let found = match &phone {
            Some(phone) => repo.contact_by_phone(phone)?,
            None => None,
        };
        let contact = match found {
            Some(contact) => contact,
            None => {
                let created = repo.create_contact(d.push_name.as_deref(), phone.as_deref())?;
                events.push("contact.created", &created);
                created
            }
        };
        repo.create_contact_inbox(contact.id, inbox.id, &d.jid).map(Some)
    }

    fn store_incoming(
        &self,
        conversation: &Conversation,
        ci: &ContactInbox,
        d: &WaMessage,
        events: &mut Events,
    ) -> Result<Option<Message>> {
        let repo = &self.core.repo;
        let attachment = self.incoming_attachment(conversation.inbox_id, d)?;
        let content_type = match &attachment {
            Some(a) => a.file_type.as_str(),
            None if TEXT_KINDS.contains(&d.kind.as_str()) => "text",
            None => d.kind.as_str(),
        };
        let caption_only = attachment.is_some()
            && (d.body.starts_with('[') && d.body.ends_with(']')
                || attachment.as_ref().and_then(|a| a.file_name.as_deref()) == Some(d.body.as_str()));
        let mut message = repo.insert_message(&NewMessage {
            conversation_id: conversation.id,
            inbox_id: conversation.inbox_id,
            message_type: if d.from_me { "outgoing" } else { "incoming" }.into(),
            content: (!caption_only).then(|| d.body.clone()),
            content_type: Some(content_type.into()),
            sender_type: Some(if d.from_me { "system" } else { "contact" }.into()),
            sender_id: (!d.from_me).then_some(ci.contact_id),
            source_id: Some(d.id.clone()),
            wa_jid: Some(d.jid.clone()),
            content_attributes: json!({}),
            created_at: d.ts,
            ..NewMessage::default()
        })?;
        if let Some(contact) = repo.contact(ci.contact_id)? {
            let name = contact
                .name
                .clone()
                .filter(|n| !n.is_empty())
                .or_else(|| d.push_name.clone());
            repo.update_contact(
                contact.id,
                &ContactChanges {
                    last_activity_at: Some(d.ts),
                    name: name.map(Some),
                    ..Default::default()
                },
            )?;
        }
        if let (Some(stored), Some(attachment)) = (&message, attachment) {
            repo.insert_attachment(&NewAttachment {
                message_id: stored.id,
                ..attachment
            })?;
            message = repo.message(stored.id)?;
        }
        if let Some(message) = &message {
            events.push("message.created", message);
        }
        Ok(message)
    }

    /// A 1–5 reply to a pending survey is recorded without reopening the resolved conversation.
    fn capture_csat(
        &self,
        conversation: Option<&Conversation>,
        ci: &ContactInbox,
        d: &WaMessage,
        events: &mut Events,
    ) -> Result<Option<Option<Message>>> {
        let now = self.core.now();
        let answer = if d.from_me || !awaiting_csat(conversation, now) {
            None
        } else {
            parse_rating(&d.body)
        };
        let (Some(answer), Some(conversation)) = (answer, conversation) else {
            return Ok(None);
        };
        let message = self.store_incoming(conversation, ci, d, events)?;
        let csat = self.core.repo.create_csat(&CsatResponse {
            id: 0,
            conversation_id: conversation.id,
            contact_id: conversation.contact_id,
            assignee_id: conversation.assignee_id,
            inbox_id: conversation.inbox_id,
            rating: answer.rating,
            feedback: answer.feedback,
            created_at: now,
        })?;
        self.core.update(
            conversation.id,
            Changes {
                csat_requested_at: Some(None),
                ..Default::default()
            },
        )?;
        events.push("csat.created", &csat);
        Ok(Some(message))
    }

    /// Live WhatsApp message (not history sync) entering the support flow.
    pub fn ingest(&self, session_id: &str, d: &WaMessage) -> Result<Option<Message>> {
        let contact = Actor::contact();
        self.core
            .commit(Some(&contact), |events| self.route(session_id, d, events))
    }

    fn route(&self, session_id: &str, d: &WaMessage, events: &mut Events) -> Result<Option<Message>> {
        let (core, repo) = (&self.core, &self.core.repo);
        let Some(inbox) = repo.inbox_for_session(session_id)? else {
            return Ok(None);
        };
        if !is_support_jid(&d.jid, inbox.ignore_groups != 0) || repo.message_by_source(inbox.id, &d.id)?.is_some() {
            return Ok(None);
        }
        let Some(ci) = self.contact_inbox_for(&inbox, d, events)? else {
            return Ok(None);
        };
        // Blocked contacts are kept out of the helpdesk (the message stays in the WhatsApp mirror).
        if !d.from_me && repo.contact(ci.contact_id)?.is_some_and(|c| c.blocked != 0) {
            return Ok(None);
        }
        let latest = repo.latest_conversation(ci.id)?;
        if let Some(message) = self.capture_csat(latest.as_ref(), &ci, d, events)? {
            return Ok(message);
        }
        // Muted conversations keep new contact messages without reopening or alerting anyone.
        let muted = latest.as_ref().is_some_and(|c| c.muted != 0);
        let route = if d.from_me {
            route_own_message(latest.as_ref())
        } else if muted {
            Route::Reuse { reopen: false }
        } else {
            route_incoming(latest.as_ref(), &inbox)
        };
        let status = initial_status(inbox.agent_bot_enabled != 0 || inbox.agent_bot_id.is_some());
        let conversation = match (route, latest) {
            (Route::Ignore, _) => return Ok(None),
            (Route::Create, _) | (Route::Reuse { .. }, None) => {
                let created = repo.create_conversation(inbox.id, &ci, status, d.ts)?;
                events.push("conversation.created", &created);
                created
            }
            (Route::Reuse { reopen: true }, Some(latest)) => {
                let changes = Changes {
                    status: Some(status.into()),
                    snoozed_until: Some(None),
                    csat_requested_at: Some(None),
                    ..Default::default()
                };
                let reopened = core.update(latest.id, changes)?;
                events.push("conversation.status_changed", &reopened);
                reopened
            }
            (Route::Reuse { reopen: false }, Some(latest)) => latest,
        };
        let message = self.store_incoming(&conversation, &ci, d, events)?;
        let mut changes = Changes {
            last_activity_at: Some(conversation.last_activity_at.max(d.ts)),
            ..Default::default()
        };
        if !d.from_me && !muted {
            changes.waiting_since = Some(Some(conversation.waiting_since.unwrap_or(d.ts)));
        }
        let updated = core.update(conversation.id, changes)?;
        if !d.from_me && !muted {
            core.auto_assign(updated, events)?;
        }
        Ok(message)
    }

    /// Delivery receipts only move a message forward (sent → delivered → read), or mark it failed.
    pub fn receipt(&self, session_id: &str, source_id: &str, status: &str) -> Result<()> {
        let repo = &self.core.repo;
        let Some(inbox) = repo.inbox_for_session(session_id)? else {
            return Ok(());
        };
        let Some(message) = repo.message_by_source(inbox.id, source_id)? else {
            return Ok(());
        };
        if status != "failed" && receipt_rank(status) <= receipt_rank(&message.status) {
            return Ok(());
        }
        let updated = repo.update_message(message.id, Some(status), None)?;
        self.core.emit("message.updated", &updated, None);
        Ok(())
    }

    /// Wakes snoozed conversations whose time has come; called periodically.
    pub fn wake_snoozed(&self) -> Result<()> {
        for id in self.core.repo.due_snoozed(self.core.now())? {
            self.core.commit(None, |events| {
                let changes = Changes {
                    status: Some("open".into()),
                    snoozed_until: Some(None),
                    ..Default::default()
                };
                let updated = self.core.update(id, changes)?;
                events.push("conversation.status_changed", &updated);
                self.core.auto_assign(updated, events)?;
                Ok(())
            })?;
        }
        Ok(())
    }
}
