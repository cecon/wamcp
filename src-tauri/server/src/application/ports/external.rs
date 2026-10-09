use crate::domain::error::Result;
use crate::domain::model::ConnectionDetail;
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
