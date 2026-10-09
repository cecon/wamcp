//! Who performs a use case: a human agent, the MCP bot of an inbox, or a server-side automation.
use super::model::User;
use serde::Serialize;

pub const BOT_NAME: &str = "Assistente IA";

#[derive(Debug, Clone, PartialEq)]
pub enum Actor {
    /// A logged-in agent or administrator.
    User(User),
    /// The MCP client acting on one inbox, like a Chatwoot agent bot.
    Bot { inbox_id: i64 },
    /// Automations (rules, greetings, CSAT, the contact itself) with full access and no user identity.
    System { kind: String, name: String },
}

/// Identifies who caused an event: `{ "type": "user" | "agent_bot" | <system kind>, "id": … }`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Performer {
    #[serde(rename = "type")]
    pub kind: String,
    pub id: Option<i64>,
}

impl Performer {
    pub fn system() -> Self {
        Self {
            kind: "system".into(),
            id: None,
        }
    }

    pub fn is(&self, kind: &str) -> bool {
        self.kind == kind
    }
}

impl Actor {
    pub fn system(kind: &str, name: &str) -> Self {
        Self::System {
            kind: kind.into(),
            name: name.into(),
        }
    }

    /// Events caused by the contact (new or reopened conversations) carry this performer.
    pub fn contact() -> Self {
        Self::system("contact", "Contato")
    }

    pub fn role(&self) -> &str {
        match self {
            Self::User(user) => &user.role,
            Self::Bot { .. } => "agent_bot",
            Self::System { .. } => "administrator",
        }
    }

    pub fn is_admin(&self) -> bool {
        self.role() == "administrator"
    }

    /// Only real agents become participants or take conversations by replying.
    pub fn is_agent(&self) -> bool {
        matches!(self, Self::User(_))
    }

    pub fn user_id(&self) -> Option<i64> {
        match self {
            Self::User(user) => Some(user.id),
            _ => None,
        }
    }

    /// Display name used in activity messages; `None` reads as "Sistema".
    pub fn name(&self) -> Option<String> {
        match self {
            Self::User(user) => Some(
                user.display_name
                    .clone()
                    .filter(|name| !name.is_empty())
                    .unwrap_or_else(|| user.name.clone()),
            ),
            Self::Bot { .. } => Some(BOT_NAME.into()),
            Self::System { name, .. } => Some(name.clone()),
        }
    }

    pub fn performer(&self) -> Performer {
        match self {
            Self::User(user) => Performer {
                kind: "user".into(),
                id: Some(user.id),
            },
            Self::Bot { inbox_id } => Performer {
                kind: "agent_bot".into(),
                id: Some(*inbox_id),
            },
            Self::System { kind, .. } => Performer {
                kind: kind.clone(),
                id: None,
            },
        }
    }

    /// Sender type stored on outgoing messages.
    pub fn sender_type(&self) -> &'static str {
        match self {
            Self::User(_) => "user",
            Self::Bot { .. } => "agent_bot",
            Self::System { .. } => "system",
        }
    }
}
