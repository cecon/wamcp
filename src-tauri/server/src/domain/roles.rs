//! Custom roles (Chatwoot): an agent with a role gets exactly its permissions; agents without one
//! keep the default agent access (every conversation of their inboxes and contacts, no reports).
use super::actor::Actor;
use super::error::{fail_with, Result};

pub const PERMISSIONS: [&str; 5] = [
    "conversation_manage",
    "conversation_unassigned_manage",
    "conversation_participating_manage",
    "contact_manage",
    "report_manage",
];

/// Which conversations a restricted agent may work on, besides those assigned to them.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ConversationLimit {
    pub user_id: i64,
    pub unassigned: bool,
    pub participating: bool,
}

pub fn has_permission(actor: &Actor, permission: &str) -> bool {
    match actor {
        Actor::System { .. } => true,
        Actor::Bot { .. } => permission.starts_with("conversation"),
        Actor::User(user) if user.role == "administrator" => true,
        Actor::User(user) => match user.custom_role_id {
            None => permission != "report_manage",
            Some(_) => user.permissions.iter().any(|p| p == permission),
        },
    }
}

pub fn require_permission(actor: &Actor, permission: &str) -> Result<()> {
    if has_permission(actor, permission) {
        Ok(())
    } else {
        fail_with("Seu perfil não tem permissão para isso", 403)
    }
}

/// `None` when the actor sees every conversation of its inboxes.
pub fn conversation_limit(actor: &Actor) -> Option<ConversationLimit> {
    match actor {
        Actor::User(user) if !has_permission(actor, "conversation_manage") => Some(ConversationLimit {
            user_id: user.id,
            unassigned: has_permission(actor, "conversation_unassigned_manage"),
            participating: has_permission(actor, "conversation_participating_manage"),
        }),
        _ => None,
    }
}

/// Whether a restricted agent may open a conversation.
pub fn within_limit(limit: &ConversationLimit, assignee_id: Option<i64>, participant_ids: &[i64]) -> bool {
    assignee_id == Some(limit.user_id)
        || (limit.unassigned && assignee_id.is_none())
        || (limit.participating && participant_ids.contains(&limit.user_id))
}
