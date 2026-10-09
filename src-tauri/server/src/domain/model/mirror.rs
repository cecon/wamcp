use serde::{Deserialize, Serialize};
use serde_json::Value;

/// A WhatsApp session (one paired phone).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Session {
    pub id: String,
    pub name: String,
    pub phone: Option<String>,
    pub status: String,
    pub created: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message_count: Option<i64>,
}

/// A chat in the local WhatsApp mirror.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Chat {
    pub session_id: String,
    pub jid: String,
    pub name: Option<String>,
    pub updated: i64,
    pub preview: Option<String>,
}

/// A chat update from WhatsApp (history sync, contacts, chat metadata).
#[derive(Debug, Clone, Default, PartialEq)]
pub struct ChatUpdate {
    pub jid: String,
    pub name: Option<String>,
    pub updated: i64,
}

/// A message in the local WhatsApp mirror (history), with media metadata when present.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MirrorMessage {
    pub session_id: String,
    pub jid: String,
    pub id: String,
    pub sender: Option<String>,
    pub body: String,
    pub kind: String,
    pub from_me: i64,
    pub ts: i64,
    pub media: Option<MediaMetadata>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MediaMetadata {
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(rename = "mimeType")]
    pub mime_type: String,
    #[serde(rename = "fileName")]
    pub file_name: Option<String>,
    pub size: Option<i64>,
    pub duration: Option<i64>,
    pub voice: bool,
}

/// Downloadable media: its metadata and the opaque WhatsApp message needed to fetch it.
#[derive(Debug, Clone, PartialEq)]
pub struct StoredMedia {
    pub metadata: MediaMetadata,
    pub payload: Vec<u8>,
}

/// A session MCP token as listed to the desktop owner (never the hash).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TokenInfo {
    pub id: String,
    pub name: String,
    pub scope: String,
    pub created: String,
    pub expires: String,
    pub last_used: Option<String>,
}

/// A freshly issued MCP token; `token` is shown once.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct IssuedToken {
    pub id: String,
    pub token: String,
    pub name: String,
    pub scope: String,
    pub expires: String,
}

/// An authenticated MCP credential (session token or OAuth grant).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Credential {
    pub id: String,
    pub session_id: String,
    pub scope: String,
    pub client_id: Option<String>,
}

impl Credential {
    pub fn can_send(&self) -> bool {
        self.scope == "read_write"
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AuditEntry {
    pub action: String,
    pub at: String,
    pub token_id: Option<String>,
}

/// QR code and last error of a session connection, shown by the desktop app.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
pub struct ConnectionDetail {
    pub qr: Option<String>,
    pub error: Option<String>,
}

/// Arbitrary JSON kept by the OAuth key-value store.
pub type OAuthValue = Value;
