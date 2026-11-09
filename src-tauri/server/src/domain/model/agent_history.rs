use serde::{Deserialize, Serialize};

/// A conversation an AI agent answered (directly or through an engine request) and whether it
/// handed the conversation to a person afterwards.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AgentConversation {
    pub id: i64,
    pub display_id: i64,
    pub inbox_id: i64,
    pub inbox_name: Option<String>,
    pub contact_name: Option<String>,
    pub status: String,
    /// Times the agent worked on it in the window (model calls and engine requests).
    pub turns: i64,
    /// ISO instants of the first and last time it worked on it.
    pub first_at: String,
    pub last_at: String,
    /// The activity note of the latest handoff in the window ("Assistente IA passou a conversa para …").
    #[serde(default, skip_serializing)]
    pub handoff_note: Option<String>,
    /// Epoch seconds of that handoff.
    pub handoff_at: Option<i64>,
    #[serde(default)]
    pub handed_to: Option<String>,
    #[serde(default)]
    pub handoff_reason: Option<String>,
}

/// One run of a schedule by an agent, with the schedule's name; times are epoch milliseconds.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AgentScheduleRun {
    pub id: i64,
    pub schedule_id: i64,
    pub schedule_name: String,
    pub status: String,
    pub output: Option<String>,
    pub error: Option<String>,
    pub started_at: i64,
    pub finished_at: Option<i64>,
}

/// What an AI agent did in the last `days` days, for its page.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct AgentHistory {
    pub days: i64,
    pub conversations: Vec<AgentConversation>,
    pub schedule_runs: Vec<AgentScheduleRun>,
}

/// The fixed start of the handoff note written by `handoff_to_human`.
pub const HANDOFF_NOTE: &str = "Assistente IA passou a conversa para ";

/// Splits a handoff note into who took the conversation and why: "… para Ana (a IA não conseguiu resolver)".
pub fn parse_handoff(note: &str) -> Option<(String, Option<String>)> {
    let rest = note.strip_prefix(HANDOFF_NOTE)?;
    match rest.strip_suffix(')').and_then(|r| r.split_once(" (")) {
        Some((name, reason)) => Some((name.to_string(), Some(reason.to_string()))),
        None => Some((rest.to_string(), None)),
    }
}
