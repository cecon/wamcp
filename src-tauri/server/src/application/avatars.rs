//! Contact photos from WhatsApp: fetched automatically when a contact without a photo writes (at
//! most once a day per contact) or on demand, downloaded and kept in the data folder
//! (`avatars/<contact>.jpg`), because WhatsApp's links expire and browsers block external images.
use super::event_bus::Envelope;
use super::helpdesk::HelpdeskService;
use super::ports::ImageFetcher;
use crate::domain::actor::Actor;
use crate::domain::error::Result;
use crate::domain::model::Contact;
use crate::domain::roles::require_permission;
use parking_lot::Mutex;
use std::collections::HashMap;
use std::sync::Arc;

/// Seconds between automatic attempts for a contact that still has no photo.
const RETRY_AFTER: i64 = 86_400;

#[derive(Clone)]
pub struct AvatarService {
    pub helpdesk: HelpdeskService,
    pub images: Arc<dyn ImageFetcher>,
    attempts: Arc<Mutex<HashMap<i64, i64>>>,
}

pub fn avatar_path(contact_id: i64) -> String {
    format!("avatars/{contact_id}.jpg")
}

impl AvatarService {
    pub fn new(helpdesk: HelpdeskService, images: Arc<dyn ImageFetcher>) -> Self {
        Self {
            helpdesk,
            images,
            attempts: Arc::default(),
        }
    }

    /// Worker: an incoming message from a contact without a photo fetches it in the background.
    pub async fn on_event(&self, envelope: Envelope) {
        let data = &envelope.data;
        if envelope.event != "message.created" || data["message_type"] != "incoming" {
            return;
        }
        let Some(contact_id) = data["sender_id"].as_i64().filter(|_| data["sender_type"] == "contact") else {
            return;
        };
        let now = self.helpdesk.core.now();
        {
            let mut attempts = self.attempts.lock();
            if attempts.get(&contact_id).is_some_and(|at| now - at < RETRY_AFTER) {
                return;
            }
            attempts.insert(contact_id, now);
        }
        let missing = matches!(self.helpdesk.core.repo.contact(contact_id), Ok(Some(c)) if c.avatar_url.is_none());
        if missing {
            let _ = self.sync(contact_id, &Actor::system("avatar", "Foto do contato")).await;
        }
    }

    /// "Atualizar foto": asks WhatsApp again now.
    pub async fn refresh(&self, actor: &Actor, contact_id: i64) -> Result<Contact> {
        require_permission(actor, "contact_manage")?;
        self.helpdesk.find_contact(contact_id)?;
        self.sync(contact_id, actor).await
    }

    async fn sync(&self, contact_id: i64, actor: &Actor) -> Result<Contact> {
        let core = &self.helpdesk.core;
        let mut photo = None;
        for channel in core.repo.contact_channels(contact_id)? {
            let found = self
                .helpdesk
                .whatsapp
                .profile_picture(&channel.session_id, &channel.source_id)
                .await;
            if let Ok(Some(url)) = found {
                photo = Some(url);
                break;
            }
        }
        let url = match photo {
            Some(remote) => match self.images.fetch(&remote).await {
                Ok(bytes) => {
                    self.helpdesk.storage.save(&avatar_path(contact_id), &bytes)?;
                    Some(format!("/api/v1/contacts/{contact_id}/photo?v={}", core.now()))
                }
                Err(_) => None,
            },
            None => None,
        };
        core.repo.set_contact_avatar(contact_id, url.as_deref())?;
        let updated = self.helpdesk.find_contact(contact_id)?;
        core.emit("contact.updated", &updated, Some(actor));
        Ok(updated)
    }

    /// The stored photo (shown next to conversations, so every agent may load it).
    pub fn photo(&self, contact_id: i64) -> Result<Option<Vec<u8>>> {
        self.helpdesk.find_contact(contact_id)?;
        self.helpdesk.storage.read(&avatar_path(contact_id))
    }
}
