use crate::domain::error::Result;
use crate::domain::model::{AgentChat, ChatMessage};

/// The chats of people logged in with AI agents (one per person and agent).
pub trait AgentChatRepo {
    /// The chat of the person with the agent, created on first use.
    fn agent_chat(&self, user_id: i64, agent_id: i64) -> Result<AgentChat>;
    fn agent_chat_by_id(&self, id: i64) -> Result<Option<AgentChat>>;
    /// The newest `limit` messages of the chat, oldest first.
    fn chat_messages(&self, chat_id: i64, limit: i64) -> Result<Vec<ChatMessage>>;
    fn add_chat_message(&self, chat_id: i64, role: &str, content: &str, at: i64) -> Result<ChatMessage>;
    /// The newest message of each chat of the person.
    fn last_chat_messages(&self, user_id: i64) -> Result<Vec<ChatMessage>>;
}
