//! An in-memory WhatsApp port: records sends and serves canned media. Used by tests and by the
//! server when it runs without the real WhatsApp adapter.
use crate::application::ports::{MessageRef, SendRequest, Typing, WhatsApp};
use crate::domain::error::{fail, Result};
use crate::domain::model::ConnectionDetail;
use async_trait::async_trait;
use parking_lot::Mutex;
use std::collections::HashSet;
use std::sync::atomic::{AtomicU64, Ordering};

/// One text sent through the port: session, recipient, text and requested message id.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Sent {
    pub session_id: String,
    pub jid: String,
    pub text: String,
    pub message_id: Option<String>,
}

#[derive(Default)]
pub struct MemoryWhatsApp {
    pub sent: Mutex<Vec<Sent>>,
    /// When set, every send fails with this message.
    pub failure: Mutex<Option<String>>,
    /// Bytes returned by `media`; `None` simulates a disconnected session.
    pub media: Mutex<Option<Vec<u8>>>,
    pub connected: Mutex<HashSet<String>>,
    /// Every text/media/quote request, in order.
    pub requests: Mutex<Vec<SendRequest>>,
    /// Other calls (`react`, `revoke`, `typing`, `read`, `block`) as readable lines.
    pub actions: Mutex<Vec<String>>,
    /// Profile picture URLs by JID.
    pub avatars: Mutex<std::collections::HashMap<String, String>>,
    counter: AtomicU64,
}

impl MemoryWhatsApp {
    pub fn sent(&self) -> Vec<Sent> {
        self.sent.lock().clone()
    }

    pub fn actions(&self) -> Vec<String> {
        self.actions.lock().clone()
    }

    fn act(&self, line: String) -> Result<()> {
        if let Some(message) = self.failure.lock().clone() {
            return fail(message);
        }
        self.actions.lock().push(line);
        Ok(())
    }

    pub fn fail_with(&self, message: Option<&str>) {
        *self.failure.lock() = message.map(String::from);
    }
}

#[async_trait]
impl WhatsApp for MemoryWhatsApp {
    async fn connect(&self, session_id: &str) -> Result<()> {
        self.connected.lock().insert(session_id.into());
        Ok(())
    }

    async fn stop(&self, session_id: &str, _logout: bool) -> Result<()> {
        self.connected.lock().remove(session_id);
        Ok(())
    }

    fn detail(&self, _session_id: &str) -> ConnectionDetail {
        ConnectionDetail::default()
    }

    async fn media(&self, _session_id: &str, _payload: &[u8]) -> Result<Vec<u8>> {
        match self.media.lock().clone() {
            Some(bytes) => Ok(bytes),
            None => fail("Conecte a sessão ao WhatsApp para baixar o anexo."),
        }
    }

    fn new_message_id(&self) -> String {
        format!("OUT{}", self.counter.fetch_add(1, Ordering::Relaxed) + 1)
    }

    async fn send(&self, session_id: &str, jid: &str, text: &str, message_id: Option<&str>) -> Result<String> {
        if let Some(message) = self.failure.lock().clone() {
            return fail(message);
        }
        let id = message_id.map_or_else(|| self.new_message_id(), String::from);
        self.sent.lock().push(Sent {
            session_id: session_id.into(),
            jid: jid.into(),
            text: text.into(),
            message_id: message_id.map(String::from),
        });
        Ok(id)
    }

    async fn send_message(&self, session_id: &str, request: &SendRequest) -> Result<String> {
        if request.media.is_none() && request.quote.is_none() {
            let text = request.text.as_deref().unwrap_or_default();
            let sent = self
                .send(session_id, &request.jid, text, request.message_id.as_deref())
                .await;
            if sent.is_ok() {
                self.requests.lock().push(request.clone());
            }
            return sent;
        }
        if let Some(message) = self.failure.lock().clone() {
            return fail(message);
        }
        self.requests.lock().push(request.clone());
        Ok(request.message_id.clone().unwrap_or_else(|| self.new_message_id()))
    }

    async fn react(&self, _session_id: &str, jid: &str, target: &MessageRef, emoji: &str) -> Result<()> {
        self.act(format!("react {jid} {} {emoji}", target.id))
    }

    async fn revoke(&self, _session_id: &str, jid: &str, message_id: &str) -> Result<()> {
        self.act(format!("revoke {jid} {message_id}"))
    }

    async fn typing(&self, _session_id: &str, jid: &str, state: Typing) -> Result<()> {
        self.act(format!("typing {jid} {state:?}"))
    }

    async fn mark_read(&self, _session_id: &str, jid: &str, message_ids: &[String]) -> Result<()> {
        self.act(format!("read {jid} {}", message_ids.join(",")))
    }

    async fn profile_picture(&self, _session_id: &str, jid: &str) -> Result<Option<String>> {
        Ok(self.avatars.lock().get(jid).cloned())
    }

    async fn block(&self, _session_id: &str, jid: &str, blocked: bool) -> Result<()> {
        self.act(format!("block {jid} {blocked}"))
    }
}
