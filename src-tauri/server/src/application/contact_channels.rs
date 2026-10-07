//! Contact actions that reach WhatsApp: blocking, profile pictures and starting a conversation.
use super::helpdesk::HelpdeskService;
use super::replies::Draft;
use crate::domain::actor::Actor;
use crate::domain::contacts::phone_jid;
use crate::domain::error::{fail_with, Result};
use crate::domain::model::{Contact, ContactChanges, Conversation};

impl HelpdeskService {
    /// Blocks or unblocks on every WhatsApp session the contact talks to; failures are logged.
    pub async fn set_blocked(&self, actor: &Actor, id: i64, blocked: bool) -> Result<Contact> {
        let changes = ContactChanges {
            blocked: Some(blocked),
            ..Default::default()
        };
        let updated = self.update_contact(actor, id, &changes)?;
        for channel in self.core.repo.contact_channels(id)? {
            if let Err(error) = self
                .whatsapp
                .block(&channel.session_id, &channel.source_id, blocked)
                .await
            {
                tracing::warn!(%error, session = %channel.session_id, "falha ao bloquear contato no WhatsApp");
            }
        }
        Ok(updated)
    }

    /// Fetches the WhatsApp profile picture from the first session that knows the contact.
    pub async fn refresh_avatar(&self, actor: &Actor, id: i64) -> Result<Contact> {
        self.find_contact(id)?;
        let mut url = None;
        for channel in self.core.repo.contact_channels(id)? {
            if let Ok(Some(found)) = self
                .whatsapp
                .profile_picture(&channel.session_id, &channel.source_id)
                .await
            {
                url = Some(found);
                break;
            }
        }
        self.core.repo.set_contact_avatar(id, url.as_deref())?;
        let updated = self.find_contact(id)?;
        self.core.emit("contact.updated", &updated, Some(actor));
        Ok(updated)
    }

    /// Opens (or reuses the unresolved) conversation with a contact in an inbox the agent reaches,
    /// optionally sending the first message (Chatwoot "new conversation").
    pub async fn start_conversation(
        &self,
        actor: &Actor,
        contact_id: i64,
        inbox_id: i64,
        content: Option<String>,
    ) -> Result<Conversation> {
        let contact = self.find_contact(contact_id)?;
        let inbox = self.core.inbox(inbox_id)?;
        if !actor.is_admin() && !self.core.member_inbox_ids(actor)?.contains(&inbox.id) {
            return fail_with("Sem acesso a esta caixa de entrada", 403);
        }
        let repo = &self.core.repo;
        let existing = repo
            .contact_channels(contact_id)?
            .into_iter()
            .find(|c| c.inbox_id == inbox_id);
        let source = match (existing, &contact.phone_number) {
            (Some(channel), _) => channel.source_id,
            (None, Some(phone)) => phone_jid(phone),
            (None, None) => return fail_with("O contato não tem telefone para iniciar a conversa", 422),
        };
        let conversation = self.core.commit(Some(actor), |events| {
            let ci = match repo.contact_inbox(inbox_id, &source)? {
                Some(ci) => ci,
                None => repo.create_contact_inbox(contact_id, inbox_id, &source)?,
            };
            if let Some(open) = repo.latest_conversation(ci.id)?.filter(|c| c.status != "resolved") {
                return Ok(open);
            }
            let created = repo.create_conversation(inbox_id, &ci, "open", self.core.now())?;
            let created = self.core.update(
                created.id,
                crate::domain::model::ConversationChanges {
                    waiting_since: Some(None),
                    assignee_id: Some(actor.user_id()),
                    ..Default::default()
                },
            )?;
            events.push("conversation.created", &created);
            Ok(created)
        })?;
        if let Some(content) = content.filter(|c| !c.trim().is_empty()) {
            let draft = Draft {
                content: Some(content),
                ..Draft::default()
            };
            self.send_draft(actor, conversation.display_id, draft).await?;
        }
        self.core.load(Some(actor), conversation.display_id)
    }
}
