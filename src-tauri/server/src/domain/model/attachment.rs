use serde::{Deserialize, Serialize};

/// A file attached to a support message (Chatwoot `attachments`), served at `data_url`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Attachment {
    pub id: i64,
    pub message_id: i64,
    pub file_type: String,
    pub mime_type: String,
    pub file_name: Option<String>,
    pub file_size: Option<i64>,
    pub duration: Option<i64>,
    pub voice: bool,
    /// Whether the file is already stored locally (incoming media is fetched in the background).
    pub downloaded: bool,
    pub data_url: String,
}

/// An attachment about to be stored; `path` is relative to the data directory.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct NewAttachment {
    pub message_id: i64,
    pub file_type: String,
    pub mime_type: String,
    pub file_name: Option<String>,
    pub file_size: Option<i64>,
    pub duration: Option<i64>,
    pub voice: bool,
    pub path: Option<String>,
}

/// Where an attachment's bytes come from: the local file, or the WhatsApp message to download.
#[derive(Debug, Clone, PartialEq)]
pub struct AttachmentSource {
    pub attachment: Attachment,
    pub path: Option<String>,
    pub session_id: String,
    pub inbox_id: i64,
    pub wa_jid: Option<String>,
    pub source_id: Option<String>,
    pub created_at: i64,
}

/// An uploaded file sent by an agent.
#[derive(Debug, Clone, PartialEq)]
pub struct Upload {
    pub file_name: Option<String>,
    pub mime_type: String,
    pub bytes: Vec<u8>,
    /// Record as a voice note (WhatsApp PTT) instead of an audio file.
    pub voice: bool,
}

/// A media message to send through WhatsApp.
#[derive(Debug, Clone, PartialEq)]
pub struct OutgoingMedia {
    pub file_type: String,
    pub mime_type: String,
    pub file_name: Option<String>,
    pub caption: Option<String>,
    pub voice: bool,
    pub seconds: Option<i64>,
    pub bytes: Vec<u8>,
}
