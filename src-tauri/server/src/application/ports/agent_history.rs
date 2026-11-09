//! What an AI agent did, for its page: the conversations it answered and its schedule runs.
use crate::domain::error::Result;
use crate::domain::model::{AgentConversation, AgentScheduleRun};

pub trait AgentHistoryRepo {
    /// Conversations the agent answered since `since_iso` (newest first), with the latest handoff
    /// note written since `since_secs`.
    fn agent_conversations(
        &self,
        agent_id: i64,
        since_iso: &str,
        since_secs: i64,
        limit: i64,
    ) -> Result<Vec<AgentConversation>>;
    /// The agent's schedule runs started since `since_ms`, newest first.
    fn agent_schedule_runs(&self, agent_id: i64, since_ms: i64, limit: i64) -> Result<Vec<AgentScheduleRun>>;
}
