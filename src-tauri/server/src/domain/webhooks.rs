//! Chatwoot-style outgoing webhooks: event names, retry schedule and validation.
use super::error::{fail, Result};

/// Chatwoot webhook event names and the internal events that produce them.
pub const WEBHOOK_EVENTS: [(&str, &[&str]); 8] = [
    ("conversation_created", &["conversation.created"]),
    ("conversation_status_changed", &["conversation.status_changed"]),
    (
        "conversation_updated",
        &["conversation.updated", "assignee.changed", "team.changed"],
    ),
    ("message_created", &["message.created"]),
    ("message_updated", &["message.updated"]),
    ("contact_created", &["contact.created"]),
    ("contact_updated", &["contact.updated"]),
    ("csat_created", &["csat.created"]),
];

pub fn is_webhook_event(name: &str) -> bool {
    WEBHOOK_EVENTS.iter().any(|(event, _)| *event == name)
}

pub fn webhook_event_for(event: &str) -> Option<&'static str> {
    WEBHOOK_EVENTS
        .iter()
        .find(|(_, sources)| sources.contains(&event))
        .map(|(name, _)| *name)
}

/// Retry schedule after a failed delivery: 30s, 2min, 10min, 1h; then the delivery is marked failed.
const BACKOFF: [i64; 4] = [30, 120, 600, 3600];
pub const MAX_ATTEMPTS: i64 = BACKOFF.len() as i64 + 1;

pub fn retry_delay(attempts: i64) -> Option<i64> {
    usize::try_from(attempts - 1).ok().and_then(|i| BACKOFF.get(i)).copied()
}

pub fn validate_webhook(url: &str, subscriptions: &[String]) -> Result<()> {
    let Ok(parsed) = url::Url::parse(url) else {
        return fail("URL inválida");
    };
    if !matches!(parsed.scheme(), "https" | "http") {
        return fail("Use uma URL http(s)");
    }
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return fail("Não inclua credenciais na URL");
    }
    if subscriptions.is_empty() || subscriptions.iter().any(|s| !is_webhook_event(s)) {
        return fail("Escolha eventos válidos");
    }
    Ok(())
}
