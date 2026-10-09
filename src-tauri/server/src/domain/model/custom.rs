use super::Condition;
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// A saved view (Chatwoot "custom filter") owned by one agent.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CustomFilter {
    pub id: i64,
    pub user_id: i64,
    pub name: String,
    pub filter_type: String,
    pub query: Value,
    pub created: String,
}

/// A typed custom attribute available on conversations or contacts.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AttributeDefinition {
    pub id: i64,
    pub attribute_display_name: String,
    pub attribute_key: String,
    pub attribute_model: String,
    pub attribute_display_type: String,
    pub attribute_description: Option<String>,
    pub attribute_values: Vec<String>,
    pub regex_pattern: Option<String>,
    pub regex_cue: Option<String>,
    pub created: String,
}

/// Editable definition columns (key and model are fixed after creation).
#[derive(Debug, Clone, Default)]
pub struct AttributeFields {
    pub display_name: Option<String>,
    pub description: Option<Option<String>>,
    pub values: Option<Vec<String>>,
    pub regex_pattern: Option<Option<String>>,
    pub regex_cue: Option<Option<String>>,
}

/// A filter run: conditions plus the caller's visibility and page.
#[derive(Debug, Clone, Default)]
pub struct FilterQuery {
    pub conditions: Vec<Condition>,
    /// `custom_attribute:<key>` kinds known to the filter (key, display type).
    pub custom: Vec<(String, String)>,
    pub visible_inbox_ids: Option<Vec<i64>>,
    pub page: i64,
    pub now: i64,
    pub limit: Option<crate::domain::roles::ConversationLimit>,
}

/// A saved sequence of actions an agent runs on conversations (Chatwoot "macro").
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Macro {
    pub id: i64,
    pub name: String,
    /// `personal` (only its author) or `global` (everyone; managed by administrators).
    pub visibility: String,
    pub created_by: Option<i64>,
    pub created_by_name: Option<String>,
    pub actions: Vec<super::Action>,
    pub created: String,
}

/// Service level targets in seconds (Chatwoot SLA policy); `None` means no target.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SlaPolicy {
    pub id: i64,
    pub name: String,
    pub description: Option<String>,
    pub first_response_time_threshold: Option<i64>,
    pub next_response_time_threshold: Option<i64>,
    pub resolution_time_threshold: Option<i64>,
    pub created: String,
}

/// The SLA applied to a conversation and its outcome (`active`, `hit` or `missed`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AppliedSla {
    pub conversation_id: i64,
    pub sla_policy_id: i64,
    pub created_at: i64,
    pub status: String,
    pub missed_at: Option<i64>,
}
