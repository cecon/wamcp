//! Pure helpdesk rules (Chatwoot-style): roles, visibility, conversation lifecycle and round robin.
use super::actor::Actor;
use super::error::{fail, fail_with, HelpdeskError, Result};
use super::model::{Conversation, Inbox};
use regex::Regex;
use std::sync::LazyLock;

pub const ROLES: [&str; 2] = ["administrator", "agent"];
pub const STATUSES: [&str; 4] = ["open", "pending", "resolved", "snoozed"];
pub const AVAILABILITY: [&str; 3] = ["online", "busy", "offline"];
pub const PRIORITIES: [&str; 4] = ["low", "medium", "high", "urgent"];
/// Chat list orderings (Chatwoot `sort_by`).
pub const SORTS: [&str; 8] = [
    "last_activity_at_desc",
    "last_activity_at_asc",
    "created_at_desc",
    "created_at_asc",
    "priority_desc",
    "priority_asc",
    "waiting_since_desc",
    "waiting_since_asc",
];
/// Chat list views beyond the assignee tabs.
pub const CONVERSATION_TYPES: [&str; 3] = ["unattended", "mentions", "participating"];

pub fn require_admin(actor: &Actor) -> Result<()> {
    if actor.is_admin() {
        Ok(())
    } else {
        fail_with("Somente administradores podem fazer isso", 403)
    }
}

/// Admins see every inbox; agents only the inboxes they are members of.
pub fn can_access_inbox(actor: &Actor, member_inbox_ids: &[i64], inbox_id: i64) -> bool {
    actor.is_admin() || member_inbox_ids.contains(&inbox_id)
}

pub fn require_inbox_access(actor: &Actor, member_inbox_ids: &[i64], inbox_id: i64) -> Result<()> {
    if can_access_inbox(actor, member_inbox_ids, inbox_id) {
        Ok(())
    } else {
        Err(HelpdeskError::not_found("Conversa não encontrada").into())
    }
}

/// WhatsApp groups, broadcasts and channels never become support conversations.
pub fn is_support_jid(jid: &str, ignore_groups: bool) -> bool {
    if jid.is_empty() || jid == "status@broadcast" || jid.ends_with("@newsletter") || jid.ends_with("@broadcast") {
        return false;
    }
    !(ignore_groups && jid.ends_with("@g.us"))
}

static PHONE_JID: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^(\d{6,15})(?::\d+)?@s\.whatsapp\.net$").expect("valid regex"));

pub fn phone_from_jid(jid: Option<&str>) -> Option<String> {
    let captures = PHONE_JID.captures(jid?)?;
    Some(format!("+{}", &captures[1]))
}

/// Where an incoming contact message lands.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Route {
    Create,
    Reuse { reopen: bool },
    Ignore,
}

/// Unresolved conversations are reused (snoozed ones wake up); a resolved one is reopened only when
/// the inbox locks each contact to a single conversation, otherwise a new conversation starts.
pub fn route_incoming(latest: Option<&Conversation>, inbox: &Inbox) -> Route {
    match latest {
        Some(c) if c.status != "resolved" => Route::Reuse {
            reopen: c.status == "snoozed",
        },
        Some(_) if inbox.lock_to_single_conversation != 0 => Route::Reuse { reopen: true },
        _ => Route::Create,
    }
}

/// Messages typed on the phone only join a conversation that is still being handled.
pub fn route_own_message(latest: Option<&Conversation>) -> Route {
    match latest {
        Some(c) if c.status != "resolved" => Route::Reuse { reopen: false },
        _ => Route::Ignore,
    }
}

/// Bots handle new conversations in `pending` until they hand off to a human.
pub fn initial_status(has_bot: bool) -> &'static str {
    if has_bot {
        "pending"
    } else {
        "open"
    }
}

pub fn validate_status_change(status: &str, snoozed_until: Option<i64>, now: i64) -> Result<()> {
    if !STATUSES.contains(&status) {
        return fail("Status inválido");
    }
    if status == "snoozed" && snoozed_until.is_some_and(|until| until <= now) {
        return fail("O adiamento precisa ser no futuro");
    }
    Ok(())
}

/// Round robin over eligible agents ordered by id, continuing after the last assignee.
pub fn next_assignee(candidates: &[i64], last_user_id: Option<i64>) -> Option<i64> {
    let mut sorted = candidates.to_vec();
    sorted.sort_unstable();
    let last = last_user_id.unwrap_or(0);
    sorted.iter().find(|&&id| id > last).or_else(|| sorted.first()).copied()
}

fn who(actor: Option<&str>) -> &str {
    actor.unwrap_or("Sistema")
}

pub fn status_activity(actor: Option<&str>, status: &str) -> String {
    let label = match status {
        "open" => "reabriu a conversa",
        "pending" => "marcou a conversa como pendente",
        "resolved" => "resolveu a conversa",
        _ => "adiou a conversa",
    };
    format!("{} {label}", who(actor))
}

pub fn assignment_activity(actor: Option<&str>, assignee: Option<&str>) -> String {
    match assignee {
        None => format!("{} removeu o responsável", who(actor)),
        Some(name) if actor == Some(name) => format!("{name} assumiu a conversa"),
        Some(name) => format!("{} atribuiu a conversa a {name}", who(actor)),
    }
}

pub fn team_activity(actor: Option<&str>, team: Option<&str>) -> String {
    match team {
        Some(team) => format!("{} atribuiu a conversa ao time {team}", who(actor)),
        None => format!("{} removeu o time", who(actor)),
    }
}

pub fn labels_activity(actor: Option<&str>, added: &[String], removed: &[String]) -> String {
    let mut parts = Vec::new();
    if !added.is_empty() {
        parts.push(format!("{} adicionou {}", who(actor), added.join(", ")));
    }
    if !removed.is_empty() {
        parts.push(format!("{} removeu {}", who(actor), removed.join(", ")));
    }
    parts.join("; ")
}

pub fn validate_password(password: &str) -> Result<()> {
    let length = password.chars().count();
    if (10..=200).contains(&length) {
        Ok(())
    } else {
        fail("A senha precisa ter entre 10 e 200 caracteres")
    }
}

static SLUG: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[\p{L}\p{N}_-]{1,40}$").expect("valid regex"));
static SPACES: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\s+").expect("valid regex"));

/// Labels are lowercase slugs, like Chatwoot (`suporte-n1`, `vip`).
pub fn normalize_label_title(title: &str) -> Result<String> {
    let slug = SPACES.replace_all(&title.trim().to_lowercase(), "-").into_owned();
    if SLUG.is_match(&slug) {
        Ok(slug)
    } else {
        fail("Etiqueta inválida")
    }
}

pub fn validate_canned_code(code: &str) -> Result<String> {
    let value = code.trim();
    if SLUG.is_match(value) {
        Ok(value.to_lowercase())
    } else {
        fail("Atalho inválido")
    }
}
