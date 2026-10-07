use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Label {
    pub id: i64,
    pub account_id: i64,
    pub title: String,
    pub description: Option<String>,
    pub color: String,
    pub show_on_sidebar: i64,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct LabelFields {
    pub title: Option<String>,
    #[serde(default, deserialize_with = "super::nullable")]
    pub description: Option<Option<String>>,
    pub color: Option<String>,
    pub show_on_sidebar: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CannedResponse {
    pub id: i64,
    pub account_id: i64,
    pub short_code: String,
    pub content: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Notification {
    pub id: i64,
    pub user_id: i64,
    pub notification_type: String,
    pub conversation_id: Option<i64>,
    pub actor_user_id: Option<i64>,
    pub read_at: Option<i64>,
    pub created_at: i64,
    #[serde(default)]
    pub snoozed_until: Option<i64>,
    pub display_id: Option<i64>,
    pub contact_name: Option<String>,
    pub actor_name: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Webhook {
    pub id: i64,
    pub account_id: i64,
    pub inbox_id: Option<i64>,
    pub url: String,
    pub subscriptions: Vec<String>,
    pub secret: String,
    pub active: i64,
    pub created: String,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct WebhookFields {
    pub url: Option<String>,
    pub subscriptions: Option<Vec<String>>,
    #[serde(default, deserialize_with = "super::nullable")]
    pub inbox_id: Option<Option<i64>>,
    pub active: Option<bool>,
}

/// A delivery attempt as listed to administrators (no payload, no secret).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Delivery {
    pub id: i64,
    pub event: String,
    pub status: String,
    pub attempts: i64,
    pub response_status: Option<i64>,
    pub last_error: Option<String>,
    pub created_at: i64,
}

/// A queued delivery joined with its webhook destination.
#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct DueDelivery {
    pub id: i64,
    pub event: String,
    pub payload: String,
    pub attempts: i64,
    pub url: String,
    pub secret: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Condition {
    pub attribute_key: String,
    pub filter_operator: String,
    #[serde(default)]
    pub values: Vec<Value>,
    #[serde(default = "and")]
    pub query_operator: String,
}

fn and() -> String {
    "and".into()
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Action {
    pub action_name: String,
    #[serde(default)]
    pub action_params: Vec<Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AutomationRule {
    pub id: i64,
    pub account_id: i64,
    pub name: String,
    pub description: Option<String>,
    pub event_name: String,
    pub conditions: Vec<Condition>,
    pub actions: Vec<Action>,
    pub active: i64,
    pub created: String,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct RuleFields {
    pub name: Option<String>,
    #[serde(default, deserialize_with = "super::nullable")]
    pub description: Option<Option<String>>,
    pub event_name: Option<String>,
    pub conditions: Option<Vec<Condition>>,
    pub actions: Option<Vec<Action>>,
    pub active: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CsatResponse {
    pub id: i64,
    pub conversation_id: i64,
    pub contact_id: i64,
    pub assignee_id: Option<i64>,
    pub inbox_id: i64,
    pub rating: i64,
    pub feedback: Option<String>,
    pub created_at: i64,
}

/// A CSAT response listed in reports, with the conversation number and people names.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CsatEntry {
    #[serde(flatten)]
    pub response: CsatResponse,
    pub display_id: i64,
    pub contact_name: Option<String>,
    pub assignee_name: Option<String>,
}

/// A reporting event (first response or resolution time, in seconds).
#[derive(Debug, Clone, PartialEq)]
pub struct ReportingEvent {
    pub name: &'static str,
    pub value: i64,
    pub user_id: Option<i64>,
    pub inbox_id: i64,
    pub conversation_id: i64,
    pub created_at: i64,
}
