//! Notification types (Chatwoot's) and @mentions in private notes.
use regex::Regex;
use serde_json::Value;
use std::sync::LazyLock;

pub const NOTIFICATION_TYPES: [&str; 6] = [
    "conversation_creation",
    "conversation_assignment",
    "assigned_conversation_new_message",
    "conversation_mention",
    "participating_conversation_new_message",
    "sla_missed",
];

/// Chatwoot's editor writes mentions as `[@Nome](mention://user/<id>/Nome)`.
static MENTION: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"mention://user/(\d+)").expect("mention regex"));

/// Distinct user ids mentioned in a note, in order of appearance.
pub fn mentioned_user_ids(content: &str) -> Vec<i64> {
    let mut ids = Vec::new();
    for captures in MENTION.captures_iter(content) {
        if let Ok(id) = captures[1].parse::<i64>() {
            if !ids.contains(&id) {
                ids.push(id);
            }
        }
    }
    ids
}

/// Types are enabled unless the agent turned them off.
pub fn is_enabled(settings: &Value, kind: &str) -> bool {
    settings.get(kind).and_then(Value::as_bool).unwrap_or(true)
}
