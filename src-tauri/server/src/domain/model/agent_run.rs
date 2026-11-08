//! An AI agent at work right now: an answer to a conversation, a turn of a person's chat with the
//! agent, a scheduled run or an engine activity. Nothing here is stored; it lives while it runs.
use serde::Serialize;

pub const RUN_CONVERSATION: &str = "conversation";
pub const RUN_CHAT: &str = "chat";
pub const RUN_SCHEDULE: &str = "schedule";
pub const RUN_ENGINE: &str = "engine";

/// Waiting for its debounce or for a free slot of the runtimes.
pub const RUN_QUEUED: &str = "queued";
pub const RUN_ACTIVE: &str = "running";

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct AgentRun {
    /// `conversation:12`, `chat:3`, `schedule:4:7` or `engine:9`: one run per thing being worked on.
    pub id: String,
    pub kind: &'static str,
    /// `queued`, `running` or, for the engine, its activity status (`waiting_approval`).
    pub state: String,
    pub agent_id: Option<i64>,
    pub agent_name: Option<String>,
    /// What it works on, for people: "Conversa #12 · Maria", "Chat com Ana", the schedule's name.
    pub title: String,
    pub inbox_id: Option<i64>,
    pub inbox_name: Option<String>,
    /// The conversation to open, when the run answers one.
    pub display_id: Option<i64>,
    /// A person's chat with the agent: only that person sees the run.
    pub owner_id: Option<i64>,
    /// The last step the runtime reported (a tool, a note).
    pub detail: Option<String>,
    /// Someone wrote again while it ran: it runs once more after this one.
    pub again: bool,
    pub queued_at: i64,
    pub started_at: Option<i64>,
    pub updated_at: i64,
}

impl AgentRun {
    /// A run about `title`; the registry sets its state and times when it is queued.
    pub fn new(id: String, kind: &'static str, title: String) -> Self {
        Self {
            id,
            kind,
            state: String::new(),
            agent_id: None,
            agent_name: None,
            title,
            inbox_id: None,
            inbox_name: None,
            display_id: None,
            owner_id: None,
            detail: None,
            again: false,
            queued_at: 0,
            started_at: None,
            updated_at: 0,
        }
    }
}

/// Who sees a run: a chat only its person; otherwise administrators, and agents of its inbox.
pub fn run_visible(run_owner: Option<i64>, run_inbox: Option<i64>, user_id: i64, admin: bool, inboxes: &[i64]) -> bool {
    match (run_owner, run_inbox) {
        (Some(owner), _) => owner == user_id,
        _ if admin => true,
        (None, Some(inbox)) => inboxes.contains(&inbox),
        (None, None) => false,
    }
}

#[cfg(test)]
mod tests {
    use super::run_visible;

    #[test]
    fn chats_are_private_and_inbox_runs_follow_the_inbox() {
        assert!(run_visible(Some(7), None, 7, false, &[]));
        assert!(!run_visible(Some(7), None, 1, true, &[]));
        assert!(run_visible(None, Some(3), 1, false, &[3]));
        assert!(!run_visible(None, Some(3), 1, false, &[4]));
        assert!(run_visible(None, None, 1, true, &[]));
        assert!(!run_visible(None, None, 1, false, &[3]));
    }
}
