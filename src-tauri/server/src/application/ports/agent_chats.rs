use crate::domain::error::Result;
use crate::domain::model::{AgentChat, ChatMessage, ChatSession};

/// The chats of people logged in with AI agents (one per person and agent).
pub trait AgentChatRepo {
    /// The chat of the person with the agent, created on first use.
    fn agent_chat(&self, user_id: i64, agent_id: i64) -> Result<AgentChat>;
    fn agent_chat_by_id(&self, id: i64) -> Result<Option<AgentChat>>;
    /// The newest `limit` messages of the chat's open session, oldest first.
    fn chat_messages(&self, chat_id: i64, limit: i64) -> Result<Vec<ChatMessage>>;
    /// The newest `limit` messages of one session of the chat, oldest first.
    fn session_messages(&self, chat_id: i64, session: i64, limit: i64) -> Result<Vec<ChatMessage>>;
    /// Adds the message to the chat's open session.
    fn add_chat_message(&self, chat_id: i64, role: &str, content: &str, at: i64) -> Result<ChatMessage>;
    /// The newest message of the open session of each chat of the person.
    fn last_chat_messages(&self, user_id: i64) -> Result<Vec<ChatMessage>>;
    /// Ends the open session and opens the next one, unless the open one has no messages yet; the
    /// chat as it is after that.
    fn new_chat_session(&self, chat_id: i64) -> Result<AgentChat>;
    /// The sessions of the chat with messages, newest first (the open one too, even if empty).
    fn chat_sessions(&self, chat_id: i64) -> Result<Vec<ChatSession>>;
}
