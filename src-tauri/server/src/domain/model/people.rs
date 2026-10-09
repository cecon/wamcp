use serde::{Deserialize, Serialize};

/// A support agent or administrator (`users` row without the password hash).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct User {
    pub id: i64,
    pub account_id: i64,
    pub email: String,
    pub name: String,
    pub display_name: Option<String>,
    pub role: String,
    pub availability: String,
    pub active: i64,
    pub created: String,
    pub last_login: Option<String>,
}

impl User {
    pub fn is_active(&self) -> bool {
        self.active != 0
    }
}

/// A user plus the inboxes they belong to, as returned by `/auth/me` and `/agents`.
#[derive(Debug, Clone, Serialize)]
pub struct Agent {
    #[serde(flatten)]
    pub user: User,
    pub inbox_ids: Vec<i64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Team {
    pub id: i64,
    pub account_id: i64,
    pub name: String,
    pub description: Option<String>,
    pub allow_auto_assign: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub member_count: Option<i64>,
}

/// Fields accepted when creating or editing a team.
#[derive(Debug, Clone, Default, Deserialize)]
pub struct TeamFields {
    pub name: Option<String>,
    #[serde(default, deserialize_with = "super::nullable")]
    pub description: Option<Option<String>>,
    pub allow_auto_assign: Option<bool>,
}

/// Credentials row used only by the login flow.
#[derive(Debug, Clone)]
pub struct Credentials {
    pub id: i64,
    pub password_hash: String,
    pub active: bool,
}

/// Editable user columns; `None` leaves a column untouched, `Some(None)` clears it.
#[derive(Debug, Clone, Default)]
pub struct UserChanges {
    pub name: Option<String>,
    pub display_name: Option<Option<String>>,
    pub role: Option<String>,
    pub availability: Option<String>,
    pub active: Option<bool>,
    pub password_hash: Option<String>,
}

/// A browser session: the cookie and CSRF token given to the client.
#[derive(Debug, Clone)]
pub struct WebSession {
    pub cookie: String,
    pub csrf: String,
}

/// Owner of a helpdesk API access token.
#[derive(Debug, Clone)]
pub struct TokenOwner {
    pub owner_type: String,
    pub owner_id: i64,
}
