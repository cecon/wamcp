use serde::{Deserialize, Serialize};
use serde_json::Value;

/// An inbox backed by one WhatsApp session (channel), with the session's live status.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Inbox {
    pub id: i64,
    pub account_id: i64,
    pub name: String,
    pub channel_type: String,
    pub channel_id: i64,
    pub enable_auto_assignment: i64,
    pub greeting_enabled: i64,
    pub greeting_message: Option<String>,
    pub lock_to_single_conversation: i64,
    pub allow_messages_after_resolved: i64,
    pub timezone: String,
    pub created: String,
    pub agent_bot_enabled: i64,
    pub working_hours_enabled: i64,
    pub out_of_office_message: Option<String>,
    pub csat_survey_enabled: i64,
    pub session_id: String,
    pub ignore_groups: i64,
    pub session_status: String,
    pub phone: Option<String>,
}

/// Inbox settings an administrator may change; `Some(None)` clears a nullable text.
#[derive(Debug, Clone, Default, Deserialize)]
pub struct InboxChanges {
    pub name: Option<String>,
    pub enable_auto_assignment: Option<bool>,
    pub greeting_enabled: Option<bool>,
    #[serde(default, deserialize_with = "super::nullable")]
    pub greeting_message: Option<Option<String>>,
    pub lock_to_single_conversation: Option<bool>,
    pub ignore_groups: Option<bool>,
    pub agent_bot_enabled: Option<bool>,
    pub working_hours_enabled: Option<bool>,
    #[serde(default, deserialize_with = "super::nullable")]
    pub out_of_office_message: Option<Option<String>>,
    pub csat_survey_enabled: Option<bool>,
    pub timezone: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WorkingHour {
    pub inbox_id: i64,
    pub day_of_week: i64,
    pub closed_all_day: i64,
    pub open_minutes: i64,
    pub close_minutes: i64,
}

/// One day of a schedule as sent by the client.
#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct DaySchedule {
    pub day_of_week: i64,
    #[serde(default)]
    pub closed_all_day: bool,
    pub open_minutes: i64,
    pub close_minutes: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Contact {
    pub id: i64,
    pub account_id: i64,
    pub name: Option<String>,
    pub phone_number: Option<String>,
    pub email: Option<String>,
    pub identifier: Option<String>,
    pub custom_attributes: Value,
    pub blocked: i64,
    pub last_activity_at: Option<i64>,
    pub created: String,
    #[serde(default)]
    pub avatar_url: Option<String>,
    #[serde(default)]
    pub labels: Vec<String>,
}

/// Editable contact columns; `Some(None)` clears a nullable column.
#[derive(Debug, Clone, Default, Deserialize)]
pub struct ContactChanges {
    #[serde(default, deserialize_with = "super::nullable")]
    pub name: Option<Option<String>>,
    #[serde(default, deserialize_with = "super::nullable")]
    pub email: Option<Option<String>>,
    #[serde(default, deserialize_with = "super::nullable")]
    pub identifier: Option<Option<String>>,
    #[serde(default, deserialize_with = "super::nullable")]
    pub phone_number: Option<Option<String>>,
    pub blocked: Option<bool>,
    #[serde(skip)]
    pub last_activity_at: Option<i64>,
}

/// The contact's identity (JID) inside one inbox.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ContactInbox {
    pub id: i64,
    pub contact_id: i64,
    pub inbox_id: i64,
    pub source_id: String,
}
