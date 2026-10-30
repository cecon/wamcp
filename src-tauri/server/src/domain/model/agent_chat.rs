use super::Message;
use serde::{Deserialize, Serialize};
use serde_json::json;

/// A private conversation, inside the app, of one person logged in with one AI agent. It never
/// touches WhatsApp or the customers' conversations.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AgentChat {
    pub id: i64,
    pub user_id: i64,
    pub agent_id: i64,
    pub created_at: i64,
    /// The open session: the agent sees only its messages; a new one starts from scratch.
    pub session: i64,
}

/// One message of an agent chat: `user` (the person), `agent` (the agent's reply) or `error`
/// (why the agent could not answer).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ChatMessage {
    pub id: i64,
    pub chat_id: i64,
    pub user_id: i64,
    pub agent_id: i64,
    pub role: String,
    pub content: String,
    pub created_at: i64,
    pub session: i64,
}

pub const CHAT_USER: &str = "user";
pub const CHAT_AGENT: &str = "agent";
pub const CHAT_ERROR: &str = "error";

/// Tokens (input, cached input and output, added over its calls) a chat session may spend; after
/// that the person starts a new session, which the agent sees from scratch.
pub const SESSION_TOKEN_LIMIT: i64 = 500_000;

/// One session of a chat: its messages and what the agent spent on it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ChatSession {
    pub number: i64,
    pub started_at: i64,
    pub last_at: i64,
    pub messages: i64,
    /// The person's first message of the session.
    pub preview: Option<String>,
    pub tokens: i64,
    pub cost_usd: f64,
}

/// Whether the session spent its tokens and the person must start a new one.
pub fn session_full(tokens: i64) -> bool {
    tokens >= SESSION_TOKEN_LIMIT
}

/// Why a full session takes no more messages.
pub const SESSION_FULL: &str = "Esta conversa chegou ao limite de tokens. Comece uma nova conversa para continuar.";

/// The usage reference of a chat session's calls (`llm_usage.run_ref`).
pub fn chat_run_ref(chat_id: i64, session: i64) -> String {
    format!("agent_chat:{chat_id}:{session}")
}

impl ChatMessage {
    /// The message as a conversation message (the person writes `incoming`, the agent answers
    /// `outgoing`), so prompts and the system agent's approvals read chats like conversations.
    /// Errors are not part of the conversation and come back as `activity`.
    pub fn as_message(&self) -> Message {
        let message_type = match self.role.as_str() {
            CHAT_USER => "incoming",
            CHAT_AGENT => "outgoing",
            _ => "activity",
        };
        Message {
            id: self.id,
            account_id: 1,
            conversation_id: 0,
            inbox_id: 0,
            message_type: message_type.into(),
            content: Some(self.content.clone()),
            content_type: "text".into(),
            private: false,
            status: "sent".into(),
            sender_type: None,
            sender_id: None,
            source_id: None,
            wa_jid: None,
            content_attributes: json!({}),
            created_at: self.created_at,
            sender_name: None,
            attachments: Vec::new(),
        }
    }
}

/// Where a proposal of the system agent was made, and where its approval must come from: an
/// administrator's WhatsApp conversation or their chat with the system agent in the app.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Thread {
    Conversation(i64),
    Chat(i64),
}
