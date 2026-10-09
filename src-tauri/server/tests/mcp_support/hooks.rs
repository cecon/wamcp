//! Port decorators that run a test hook in the middle of an operation.
use crate::common::RecordingCallback;
use async_trait::async_trait;
use parking_lot::Mutex;
use serde_json::Value;
use std::sync::Arc;
use wamcp_server::adapters::outbound::whatsapp::memory::MemoryWhatsApp;
use wamcp_server::application::ports::{CallbackError, CallbackResponse, EventCallback, WhatsApp};
use wamcp_server::domain::error::Result;
use wamcp_server::domain::model::ConnectionDetail;

type Hook = Arc<dyn Fn() + Send + Sync>;

/// WhatsApp port delegating to the fixture's memory adapter, with a hook run while media downloads.
pub struct HookedWhatsApp {
    pub inner: Arc<MemoryWhatsApp>,
    pub on_media: Mutex<Option<Hook>>,
}

#[async_trait]
impl WhatsApp for HookedWhatsApp {
    async fn connect(&self, session_id: &str) -> Result<()> {
        self.inner.connect(session_id).await
    }
    async fn stop(&self, session_id: &str, logout: bool) -> Result<()> {
        self.inner.stop(session_id, logout).await
    }
    fn detail(&self, session_id: &str) -> ConnectionDetail {
        self.inner.detail(session_id)
    }
    async fn media(&self, session_id: &str, payload: &[u8]) -> Result<Vec<u8>> {
        let hook = self.on_media.lock().clone();
        if let Some(hook) = hook {
            hook();
        }
        self.inner.media(session_id, payload).await
    }
    fn new_message_id(&self) -> String {
        self.inner.new_message_id()
    }
    async fn send(&self, session_id: &str, jid: &str, text: &str, id: Option<&str>) -> Result<String> {
        self.inner.send(session_id, jid, text, id).await
    }
}

/// Event callback delegating to the recording one, with a hook run during verification.
pub struct HookedCallback {
    pub inner: Arc<RecordingCallback>,
    pub on_verify: Mutex<Option<Hook>>,
}

#[async_trait]
impl EventCallback for HookedCallback {
    async fn verify(&self, url: &str, sub: &str, secret: &str) -> std::result::Result<(), CallbackError> {
        let hook = self.on_verify.lock().clone();
        if let Some(hook) = hook {
            hook();
        }
        self.inner.verify(url, sub, secret).await
    }
    async fn deliver(
        &self,
        url: &str,
        sub: &str,
        secrets: &[String],
        event: &Value,
    ) -> std::result::Result<CallbackResponse, CallbackError> {
        self.inner.deliver(url, sub, secrets, event).await
    }
}
