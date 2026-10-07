use crate::domain::error::Result;
use crate::domain::model::{
    AuditEntry, Chat, ChatUpdate, Credential, IssuedToken, MediaMetadata, MirrorMessage, Session,
    StoredMedia, TokenInfo, WaMessage,
};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

/// WhatsApp sessions, the local message mirror (history) and session MCP tokens.
pub trait MirrorRepo {
    fn sessions(&self) -> Result<Vec<Session>>;
    fn session(&self, id: &str) -> Result<Option<Session>>;
    fn create_session(&self, name: &str) -> Result<Session>;
    fn set_status(&self, id: &str, status: &str, phone: Option<&str>) -> Result<()>;
    fn upsert_chat(&self, session_id: &str, chat: &ChatUpdate) -> Result<()>;
    /// Stores the message (and media) in the mirror; `true` only when it was not stored before.
    fn store_message(&self, session_id: &str, message: &WaMessage, media: Option<(&MediaMetadata, &[u8])>) -> Result<bool>;
    fn chats(&self, session_id: &str, q: &str) -> Result<Vec<Chat>>;
    fn mirror_messages(&self, session_id: &str, jid: &str, page: &HistoryPage) -> Result<Vec<MirrorMessage>>;
    fn search(&self, session_id: &str, q: &str, limit: i64) -> Result<Vec<MirrorMessage>>;
    fn media(&self, session_id: &str, jid: &str, id: &str) -> Result<Option<StoredMedia>>;

    fn issue_token(&self, session_id: &str, name: &str, scope: &str, days: i64) -> Result<IssuedToken>;
    fn tokens(&self, session_id: &str) -> Result<Vec<TokenInfo>>;
    fn authenticate(&self, session_id: &str, token: &str) -> Result<Option<Credential>>;
    fn revoke(&self, session_id: &str, token_id: &str) -> Result<()>;
    fn event_principal(&self, session_id: &str, token_id: &str) -> Result<Option<Credential>>;
    fn audit(&self, session_id: &str, token_id: &str, action: &str) -> Result<()>;
    fn audit_events(&self, session_id: &str) -> Result<Vec<AuditEntry>>;
}

/// History cursor: messages strictly before (`before`, `before_id`), newest `limit`, oldest first.
#[derive(Debug, Clone, PartialEq)]
pub struct HistoryPage {
    pub before: Option<f64>,
    pub before_id: Option<String>,
    pub limit: i64,
}

/// Expiring key-value buckets used by the OAuth server (clients, codes, grants, tokens).
/// Times are epoch milliseconds; `get`/`list` only return items that expire after `now`.
pub trait OAuthRepo {
    fn get(&self, bucket: &str, key: &str, now: i64) -> Result<Option<Value>>;
    fn set(&self, bucket: &str, key: &str, value: &Value, expires: i64) -> Result<()>;
    fn remove(&self, bucket: &str, key: &str) -> Result<()>;
    fn list(&self, bucket: &str, now: i64) -> Result<Vec<Value>>;
    fn prune(&self, now: i64) -> Result<()>;
}

/// A webhook subscription to `message.created`, stored as JSON (camelCase keys, as in v1 rows).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Subscription {
    pub session_id: String,
    pub principal_id: String,
    pub principal_kind: String,
    pub id: String,
    pub name: String,
    pub args: Map<String, Value>,
    pub url: String,
    pub secret: String,
    pub expires: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub previous_secret: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rotate_until: Option<i64>,
}

/// A queued event delivery for one subscription.
#[derive(Debug, Clone, PartialEq)]
pub struct QueueItem {
    pub subscription_id: String,
    pub event_id: String,
    pub event: Value,
    pub attempts: i64,
}

/// Durable subscriptions, per-subscription delivery queue, receipts and attempt diagnostics.
pub trait EventRepo {
    fn subscription(&self, id: &str) -> Result<Option<Subscription>>;
    fn subscriptions(&self, session_id: Option<&str>) -> Result<Vec<Subscription>>;
    fn save_subscription(&self, subscription: &Subscription) -> Result<()>;
    fn remove_subscription(&self, id: &str) -> Result<()>;
    fn remove_session_subscriptions(&self, session_id: &str) -> Result<()>;
    fn prune_events(&self, now: i64) -> Result<()>;
    fn enqueue(&self, subscription: &Subscription, event: &Value, now: i64) -> Result<bool>;
    fn due(&self, now: i64, limit: i64) -> Result<Vec<QueueItem>>;
    fn has_pending(&self, item: &QueueItem) -> Result<bool>;
    fn retry(&self, item: &QueueItem, next_attempt: i64) -> Result<()>;
    fn finish(&self, item: &QueueItem) -> Result<()>;
    fn record(&self, item: &QueueItem, status: i64, outcome: &str, now: i64) -> Result<()>;
}
