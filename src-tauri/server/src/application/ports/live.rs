//! What the live view of the AI agents keeps: which agents are paused, which conversations still
//! wait for an answer (the queue survives a restart because it is the conversations' own state),
//! and the summary of the start of long conversations.
use crate::domain::error::Result;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConversationSummary {
    pub conversation_id: i64,
    pub summary: String,
    /// The last message the summary covers.
    pub upto_message_id: i64,
}

pub trait LiveRepo {
    fn paused_agents(&self) -> Result<Vec<i64>>;
    fn set_agent_paused(&self, agent_id: i64, paused: bool) -> Result<()>;
    /// `pending` conversations whose last public message came from the contact.
    fn unanswered_conversations(&self) -> Result<Vec<i64>>;
    fn conversation_summary(&self, conversation_id: i64) -> Result<Option<ConversationSummary>>;
    fn save_conversation_summary(&self, summary: &ConversationSummary) -> Result<()>;
}
