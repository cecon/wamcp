//! Attachment files: metadata for incoming media, background download into the data directory and
//! authenticated reads for the agent UI.
use super::event_bus::Envelope;
use super::helpdesk::HelpdeskService;
use crate::domain::actor::Actor;
use crate::domain::error::{fail, HelpdeskError, Result};
use crate::domain::helpdesk::require_inbox_access;
use crate::domain::media::{extension, file_type_for, storage_path};
use crate::domain::model::{Attachment, AttachmentSource, MediaMetadata, NewAttachment, WaMessage};

/// Media metadata kinds as recorded by the WhatsApp adapter.
fn file_type(meta: &MediaMetadata) -> String {
    match meta.kind.as_str() {
        "document" => "file".into(),
        "sticker" => "sticker".into(),
        _ => file_type_for(&meta.mime_type).into(),
    }
}

impl HelpdeskService {
    /// The attachment for an incoming media message, from the mirror's metadata (file fetched later).
    pub(crate) fn incoming_attachment(&self, inbox_id: i64, d: &WaMessage) -> Result<Option<NewAttachment>> {
        let inbox = self.core.inbox(inbox_id)?;
        let Some(media) = self.core.repo.media(&inbox.session_id, &d.jid, &d.id)? else {
            return Ok(None);
        };
        let meta = media.metadata;
        Ok(Some(NewAttachment {
            message_id: 0,
            file_type: file_type(&meta),
            mime_type: meta.mime_type.clone(),
            file_name: meta.file_name.clone(),
            file_size: meta.size,
            duration: meta.duration,
            voice: meta.voice,
            path: None,
        }))
    }

    fn source(&self, id: i64) -> Result<AttachmentSource> {
        self.core
            .repo
            .attachment_source(id)?
            .ok_or_else(|| HelpdeskError::not_found("Anexo não encontrado").into())
    }

    /// The file of an attachment the actor may see, downloading it from WhatsApp on first access.
    pub async fn attachment_file(&self, actor: &Actor, id: i64) -> Result<(Attachment, Vec<u8>)> {
        let source = self.source(id)?;
        let members = self.core.member_inbox_ids(actor)?;
        require_inbox_access(actor, &members, source.inbox_id)
            .map_err(|_| HelpdeskError::not_found("Anexo não encontrado"))?;
        let bytes = self.fetch(&source).await?;
        Ok((source.attachment, bytes))
    }

    async fn fetch(&self, source: &AttachmentSource) -> Result<Vec<u8>> {
        if let Some(path) = &source.path {
            if let Some(bytes) = self.storage.read(path)? {
                return Ok(bytes);
            }
        }
        let (Some(jid), Some(message_id)) = (&source.wa_jid, &source.source_id) else {
            return fail("Arquivo indisponível");
        };
        let Some(media) = self.core.repo.media(&source.session_id, jid, message_id)? else {
            return fail("Arquivo indisponível no histórico local");
        };
        let bytes = self.whatsapp.media(&source.session_id, &media.payload).await?;
        let attachment = &source.attachment;
        let ext = extension(&attachment.mime_type, attachment.file_name.as_deref());
        let path = storage_path(&source.session_id, source.created_at, message_id, &ext);
        self.storage.save(&path, &bytes)?;
        self.core
            .repo
            .set_attachment_file(attachment.id, &path, bytes.len() as i64)?;
        Ok(bytes)
    }

    /// Bus listener: incoming media is saved to disk right away, so files survive WhatsApp's expiry.
    pub async fn prefetch(&self, envelope: &Envelope) {
        if envelope.event != "message.created" {
            return;
        }
        let pending = envelope.data["attachments"].as_array().cloned().unwrap_or_default();
        for attachment in pending.iter().filter(|a| a["downloaded"] == false) {
            if let Some(id) = attachment["id"].as_i64() {
                if let Ok(source) = self.source(id) {
                    let _ = self.fetch(&source).await;
                }
            }
        }
    }
}
