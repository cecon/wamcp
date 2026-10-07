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
}
