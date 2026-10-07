use crate::domain::error::{fail, Result};
use crate::domain::model::{ConnectionDetail, OutgoingMedia};
use async_trait::async_trait;
use serde_json::Value;

/// Wall clock in epoch seconds and milliseconds (injectable for tests).
pub trait Clock: Send + Sync {
    fn now_ms(&self) -> i64;
    fn now(&self) -> i64 {
        self.now_ms().div_euclid(1000)
    }
}

/// Password hashing (scrypt in production).
#[async_trait]
pub trait PasswordHasher: Send + Sync {
    async fn hash(&self, password: &str) -> Result<String>;
    async fn verify(&self, password: &str, stored: &str) -> bool;
}

/// The WhatsApp connection manager: one socket per session.
#[async_trait]
pub trait WhatsApp: Send + Sync {
    async fn connect(&self, session_id: &str) -> Result<()>;
    async fn stop(&self, session_id: &str, logout: bool) -> Result<()>;
    fn detail(&self, session_id: &str) -> ConnectionDetail;
    /// Downloads the media of a stored message (`payload` is the adapter's opaque message bytes).
    async fn media(&self, session_id: &str, payload: &[u8]) -> Result<Vec<u8>>;
    fn new_message_id(&self) -> String;
    /// Sends a text message and returns the WhatsApp message id.
    async fn send(&self, session_id: &str, jid: &str, text: &str, message_id: Option<&str>) -> Result<String>;

    /// Sends text or media, optionally quoting another message; returns the WhatsApp message id.
    async fn send_message(&self, session_id: &str, request: &SendRequest) -> Result<String> {
        match (&request.media, &request.quote) {
            (None, None) => {
                let text = request.text.as_deref().unwrap_or_default();
                self.send(session_id, &request.jid, text, request.message_id.as_deref())
                    .await
            }
            _ => fail("Envio de mídia indisponível nesta sessão"),
        }
    }
    /// Reacts to a message (an empty emoji removes the reaction).
    async fn react(&self, _session_id: &str, _jid: &str, _target: &MessageRef, _emoji: &str) -> Result<()> {
        fail("Reações indisponíveis nesta sessão")
    }
    /// Deletes one of our messages for everyone.
    async fn revoke(&self, _session_id: &str, _jid: &str, _message_id: &str) -> Result<()> {
        fail("Não é possível apagar mensagens nesta sessão")
    }
    /// Shows or hides "typing…" (or "recording audio…") to the contact.
    async fn typing(&self, _session_id: &str, _jid: &str, _state: Typing) -> Result<()> {
        Ok(())
    }
    /// Sends read receipts for messages the agent has seen.
    async fn mark_read(&self, _session_id: &str, _jid: &str, _message_ids: &[String]) -> Result<()> {
        Ok(())
    }
    /// The contact's profile picture URL, when visible.
    async fn profile_picture(&self, _session_id: &str, _jid: &str) -> Result<Option<String>> {
        Ok(None)
    }
    /// Blocks or unblocks the contact on WhatsApp.
    async fn block(&self, _session_id: &str, _jid: &str, _blocked: bool) -> Result<()> {
        Ok(())
    }
}

/// A message to send through WhatsApp.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct SendRequest {
    pub jid: String,
    pub text: Option<String>,
    pub media: Option<OutgoingMedia>,
    pub quote: Option<Quote>,
    pub message_id: Option<String>,
}

/// The message being answered (shown as a quote on the phone).
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Quote {
    pub id: String,
    pub from_me: bool,
    pub text: String,
}

/// Identifies a WhatsApp message in a chat.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct MessageRef {
    pub id: String,
    pub from_me: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Typing {
    Composing,
    Recording,
    Paused,
}

/// Stores attachment files under the data directory (relative paths like `media/<session>/2026/10/x.jpg`).
pub trait MediaStorage: Send + Sync {
    fn save(&self, path: &str, bytes: &[u8]) -> Result<()>;
    fn read(&self, path: &str) -> Result<Option<Vec<u8>>>;
}

/// Why a webhook delivery failed before getting an HTTP status.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SendFailure {
    Timeout,
    Connection,
}

/// Signs and posts Chatwoot-style helpdesk webhooks.
#[async_trait]
pub trait WebhookSender: Send + Sync {
    fn secret(&self) -> String;
    /// Posts the payload and returns the HTTP status.
    async fn post(&self, url: &str, body: &Value, secret: &str) -> std::result::Result<u16, SendFailure>;
}

/// A delivery response from an MCP event callback.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CallbackResponse {
    pub status: u16,
    pub body: String,
}

/// Why an MCP event callback could not be reached (`invalid_url`, `timeout`, `delivery_failed`…).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CallbackError {
    pub reason: String,
}

/// Standard Webhooks signed POSTs to MCP event subscribers (SSRF-safe in production).
#[async_trait]
pub trait EventCallback: Send + Sync {
    /// Verifies the subscriber echoes a random challenge.
    async fn verify(&self, url: &str, subscription_id: &str, secret: &str) -> std::result::Result<(), CallbackError>;
    async fn deliver(
        &self,
        url: &str,
        subscription_id: &str,
        secrets: &[String],
        event: &Value,
    ) -> std::result::Result<CallbackResponse, CallbackError>;
}
