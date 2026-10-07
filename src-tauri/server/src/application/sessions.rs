//! WhatsApp sessions as seen by the desktop owner, and MCP access to one session's data.
use super::events::EventService;
use super::helpdesk::HelpdeskService;
use super::oauth::OAuthService;
use super::ports::{HistoryPage, Repository, WhatsApp};
use crate::domain::access::{media_too_large, require_send_permission, require_session_credential, MEDIA_TOO_LARGE};
use crate::domain::error::{fail, Error, HelpdeskError, Result};
use crate::domain::model::{
    AuditEntry, Chat, ConnectionDetail, Credential, IssuedToken, MediaMetadata, MirrorMessage, Session, TokenInfo,
};
use std::sync::Arc;

#[derive(Clone)]
pub struct SessionService {
    pub repo: Arc<dyn Repository>,
    pub whatsapp: Arc<dyn WhatsApp>,
    pub events: Option<EventService>,
}

impl SessionService {
    fn exists(&self, id: &str) -> Result<Session> {
        self.repo
            .session(id)?
            .ok_or_else(|| HelpdeskError::not_found("Sessão não encontrada").into())
    }

    pub fn sessions(&self) -> Result<Vec<Session>> {
        self.repo.sessions()
    }

    pub fn session(&self, id: &str) -> Result<Option<Session>> {
        self.repo.session(id)
    }

    pub fn create_session(&self, name: &str) -> Result<Session> {
        self.repo.create_session(name)
    }

    pub fn detail(&self, id: &str) -> Result<ConnectionDetail> {
        self.exists(id)?;
        Ok(self.whatsapp.detail(id))
    }

    pub async fn connect(&self, id: &str) -> Result<()> {
        self.exists(id)?;
        self.whatsapp.connect(id).await
    }

    pub async fn stop(&self, id: &str, logout: bool) -> Result<()> {
        self.exists(id)?;
        if let Some(events) = &self.events {
            events.disconnect(id)?;
        }
        self.whatsapp.stop(id, logout).await
    }

    pub fn chats(&self, id: &str, q: &str) -> Result<Vec<Chat>> {
        self.exists(id)?;
        self.repo.chats(id, q)
    }

    pub fn messages(&self, id: &str, jid: &str, page: &HistoryPage) -> Result<Vec<MirrorMessage>> {
        self.exists(id)?;
        self.repo.mirror_messages(id, jid, page)
    }

    pub fn search(&self, id: &str, q: &str, limit: i64) -> Result<Vec<MirrorMessage>> {
        self.exists(id)?;
        self.repo.search(id, q, limit)
    }

    pub fn tokens(&self, id: &str) -> Result<Vec<TokenInfo>> {
        self.exists(id)?;
        self.repo.tokens(id)
    }

    pub fn issue_token(&self, id: &str, name: &str, scope: &str, days: i64) -> Result<IssuedToken> {
        self.exists(id)?;
        self.repo.issue_token(id, name, scope, days)
    }

    pub fn revoke(&self, id: &str, token_id: &str) -> Result<()> {
        self.exists(id)?;
        self.repo.revoke(id, token_id)
    }

    pub fn audit(&self, id: &str) -> Result<Vec<AuditEntry>> {
        self.exists(id)?;
        self.repo.audit_events(id)
    }
}

/// Downloaded media for the MCP `get_media` tool.
pub struct MediaFile {
    pub metadata: MediaMetadata,
    pub data: Vec<u8>,
}

/// MCP use cases on one session: every call is authenticated, scoped to the session and audited.
#[derive(Clone)]
pub struct McpService {
    pub repo: Arc<dyn Repository>,
    pub whatsapp: Arc<dyn WhatsApp>,
    pub oauth: Option<OAuthService>,
    /// Helpdesk use cases executed as this session's inbox bot (absent when the helpdesk is off).
    pub helpdesk: Option<HelpdeskService>,
}

impl McpService {
    pub fn authenticate(&self, session_id: &str, credential: &str) -> Option<Credential> {
        if credential.is_empty() {
            return None;
        }
        if let Ok(Some(token)) = self.repo.authenticate(session_id, credential) {
            return Some(token);
        }
        self.oauth.as_ref()?.authenticate(session_id, credential)
    }

    pub fn session(&self, id: &str) -> Result<Option<Session>> {
        self.repo.session(id)
    }

    /// Read operation: the credential must belong to the session; the action is audited first.
    pub fn read<T>(
        &self,
        id: &str,
        token: &Credential,
        action: &str,
        operation: impl FnOnce() -> Result<T>,
    ) -> Result<T> {
        require_session_credential(token, id)?;
        self.repo.audit(id, &token.id, action)?;
        operation()
    }

    /// Write operation on the helpdesk: needs send permission on this session and is audited.
    pub async fn act<T, F>(&self, id: &str, token: &Credential, action: &str, operation: F) -> Result<T>
    where
        F: std::future::Future<Output = Result<T>>,
    {
        require_send_permission(token, id)?;
        let result = operation.await?;
        self.repo.audit(id, &token.id, action)?;
        Ok(result)
    }

    pub async fn send(&self, id: &str, token: &Credential, jid: &str, text: &str) -> Result<String> {
        require_send_permission(token, id)?;
        let sent = self.whatsapp.send(id, jid, text, None).await?;
        self.repo.audit(id, &token.id, "send_message")?;
        Ok(sent)
    }

    pub async fn media(&self, id: &str, token: &Credential, jid: &str, message_id: &str) -> Result<MediaFile> {
        require_session_credential(token, id)?;
        let Some(media) = self.repo.media(id, jid, message_id)? else {
            return fail(
                "Anexo indisponível no histórico local. Consulte uma mensagem sincronizada após a atualização.",
            );
        };
        if media_too_large(media.metadata.size) {
            return fail(MEDIA_TOO_LARGE);
        }
        self.repo.audit(id, &token.id, "get_media")?;
        let data = self.whatsapp.media(id, &media.payload).await?;
        if data.len() > crate::domain::access::MAX_MEDIA_BYTES {
            return Err(Error::from(HelpdeskError::new(MEDIA_TOO_LARGE)));
        }
        Ok(MediaFile {
            metadata: media.metadata,
            data,
        })
    }
}
