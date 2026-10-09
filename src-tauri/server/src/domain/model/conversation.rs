use serde::{Deserialize, Serialize};
use serde_json::Value;

/// A support conversation with the joined names and counters the agent UI shows.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Conversation {
    pub id: i64,
    pub account_id: i64,
    pub display_id: i64,
    pub inbox_id: i64,
    pub contact_id: i64,
    pub contact_inbox_id: i64,
    pub status: String,
    pub priority: Option<String>,
    pub assignee_id: Option<i64>,
    pub team_id: Option<i64>,
    pub snoozed_until: Option<i64>,
    pub waiting_since: Option<i64>,
    pub first_reply_at: Option<i64>,
    pub agent_last_seen_at: Option<i64>,
    pub last_activity_at: i64,
    pub custom_attributes: Value,
    pub created: String,
    pub csat_requested_at: Option<i64>,
    #[serde(default)]
    pub muted: i64,
    pub contact_name: Option<String>,
    pub contact_phone: Option<String>,
    #[serde(default)]
    pub contact_avatar_url: Option<String>,
    pub contact_jid: String,
    pub inbox_name: String,
    pub agent_bot_enabled: i64,
    pub assignee_name: Option<String>,
    pub team_name: Option<String>,
    pub labels: Vec<String>,
    pub last_message: Option<String>,
    pub unread_count: i64,
    /// `active`, `hit` or `missed` when an SLA is applied.
    #[serde(default)]
    pub sla_status: Option<String>,
}

/// Lifecycle columns a use case may change; the outer `Option` means "leave untouched".
#[derive(Debug, Clone, Default, PartialEq)]
pub struct ConversationChanges {
    pub status: Option<String>,
    pub priority: Option<Option<String>>,
    pub assignee_id: Option<Option<i64>>,
    pub team_id: Option<Option<i64>>,
    pub snoozed_until: Option<Option<i64>>,
    pub waiting_since: Option<Option<i64>>,
    pub first_reply_at: Option<Option<i64>>,
    pub agent_last_seen_at: Option<Option<i64>>,
    pub last_activity_at: Option<i64>,
    pub csat_requested_at: Option<Option<i64>>,
    pub muted: Option<bool>,
}

/// List filters shared by the conversation list and the tab counters.
#[derive(Debug, Clone, Default)]
pub struct ConversationFilters {
    pub status: Option<String>,
    pub assignee_type: Option<String>,
    pub inbox_id: Option<i64>,
    pub team_id: Option<i64>,
    pub label: Option<String>,
    pub q: Option<String>,
    pub page: i64,
    pub user_id: Option<i64>,
    pub visible_inbox_ids: Option<Vec<i64>>,
    /// One of `domain::helpdesk::SORTS` (default `last_activity_at_desc`).
    pub sort_by: Option<String>,
    /// `unattended` (no first reply yet, or waiting), `mentions` or `participating`.
    pub conversation_type: Option<String>,
    /// Set for agents whose custom role limits which conversations they see.
    pub limit: Option<crate::domain::roles::ConversationLimit>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct ConversationCounts {
    pub mine: i64,
    pub unassigned: i64,
    pub all: i64,
}

/// A support message: incoming, outgoing, private note or activity.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Message {
    pub id: i64,
    pub account_id: i64,
    pub conversation_id: i64,
    pub inbox_id: i64,
    pub message_type: String,
    pub content: Option<String>,
    pub content_type: String,
    pub private: bool,
    pub status: String,
    pub sender_type: Option<String>,
    pub sender_id: Option<i64>,
    pub source_id: Option<String>,
    pub wa_jid: Option<String>,
    pub content_attributes: Value,
    pub created_at: i64,
    pub sender_name: Option<String>,
    #[serde(default)]
    pub attachments: Vec<super::Attachment>,
}

/// A message about to be stored.
#[derive(Debug, Clone, Default)]
pub struct NewMessage {
    pub conversation_id: i64,
    pub inbox_id: i64,
    pub message_type: String,
    pub content: Option<String>,
    pub content_type: Option<String>,
    pub private: bool,
    pub status: Option<String>,
    pub sender_type: Option<String>,
    pub sender_id: Option<i64>,
    pub source_id: Option<String>,
    pub wa_jid: Option<String>,
    pub content_attributes: Value,
    pub created_at: i64,
}

/// A WhatsApp message as seen by the helpdesk ingestion (already described by the adapter).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WaMessage {
    pub id: String,
    pub jid: String,
    #[serde(rename = "altJid")]
    pub alt_jid: Option<String>,
    #[serde(rename = "fromMe")]
    pub from_me: bool,
    pub sender: String,
    #[serde(rename = "pushName")]
    pub push_name: Option<String>,
    pub body: String,
    pub kind: String,
    pub ts: i64,
}
