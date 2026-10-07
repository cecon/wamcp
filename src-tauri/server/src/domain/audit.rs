//! Audit log entries for administrative changes made through the API (Chatwoot's audit logs).

/// What an audited request did: `create`, `update`, `delete` or a named action (e.g. `clone`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AuditEntry {
    pub action: String,
    pub auditable_type: String,
    pub auditable_id: Option<i64>,
}

/// Resources whose changes are recorded, by API path segment.
const AUDITED: [(&str, &str); 14] = [
    ("agents", "user"),
    ("teams", "team"),
    ("inboxes", "inbox"),
    ("labels", "label"),
    ("canned_responses", "canned_response"),
    ("automation_rules", "automation_rule"),
    ("macros", "macro"),
    ("webhooks", "webhook"),
    ("custom_attribute_definitions", "custom_attribute_definition"),
    ("account", "account"),
    ("profile", "profile"),
    ("contacts", "contact"),
    ("conversations", "conversation"),
    ("sla_policies", "sla_policy"),
];

/// Sub-actions that are daily work rather than configuration changes.
const NOT_AUDITED: [&str; 10] = [
    "execute",
    "messages",
    "notes",
    "labels",
    "avatar",
    "unread",
    "mute",
    "unmute",
    "custom_attributes",
    "filter",
];

/// Maps a successful mutating request (`/api/v1` relative path) to an audit entry:
/// `POST /x` create, `PATCH /x/1` update, `DELETE /x/1` delete, `POST /x/1/clone` clone and
/// `DELETE /x/1/mfa` remove_mfa. Contacts and conversations only record deletions, imports and merges.
pub fn audit_entry(method: &str, path: &str) -> Option<AuditEntry> {
    if !matches!(method, "POST" | "PATCH" | "PUT" | "DELETE") {
        return None;
    }
    let segments: Vec<&str> = path.trim_matches('/').split('/').filter(|s| !s.is_empty()).collect();
    if segments == ["actions", "contact_merge"] {
        return Some(entry("merge", "contact", None));
    }
    let (resource, rest) = segments.split_first()?;
    let kind = AUDITED.iter().find(|(name, _)| name == resource)?.1;
    let id = rest.first().and_then(|s| s.parse::<i64>().ok());
    let sub = rest.iter().rev().find(|s| s.parse::<i64>().is_err()).copied();
    let action = match (method, sub) {
        (_, Some(sub)) if NOT_AUDITED.contains(&sub) => return None,
        ("DELETE", Some(sub)) => format!("remove_{sub}"),
        (_, Some(sub)) => sub.to_string(),
        ("POST", None) => "create".into(),
        ("PATCH" | "PUT", None) => "update".into(),
        ("DELETE", None) => "delete".into(),
        _ => return None,
    };
    let configuration = match kind {
        "contact" => action == "delete" || action == "import",
        "conversation" => action == "delete",
        "profile" => sub.is_some_and(|s| matches!(s, "mfa" | "verify" | "sessions" | "access_token")),
        _ => true,
    };
    configuration.then(|| entry(&action, kind, id))
}

fn entry(action: &str, kind: &str, id: Option<i64>) -> AuditEntry {
    AuditEntry {
        action: action.to_string(),
        auditable_type: kind.to_string(),
        auditable_id: id,
    }
}
