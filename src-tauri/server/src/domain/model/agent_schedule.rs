use serde::{Deserialize, Serialize};

/// A recurring job AI agents subscribe to: on each run every subscribed agent works on `prompt` by
/// itself, through its own runtime (like Claude Code's `/loop`). It runs on a cron expression or
/// every `interval_minutes`; times are epoch milliseconds.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AgentSchedule {
    pub id: i64,
    pub name: String,
    pub cron: Option<String>,
    pub interval_minutes: Option<i64>,
    pub timezone: String,
    pub prompt: String,
    pub active: bool,
    /// Who created it: each run's output goes to this person's chat with the agent.
    pub created_by: Option<i64>,
    pub last_run_at: Option<i64>,
    pub next_run_at: Option<i64>,
    pub created_at: i64,
    #[serde(default)]
    pub agent_ids: Vec<i64>,
}

impl AgentSchedule {
    /// What an administrator set on it.
    pub fn draft(&self) -> AgentScheduleDraft {
        AgentScheduleDraft {
            name: self.name.clone(),
            cron: self.cron.clone(),
            interval_minutes: self.interval_minutes,
            timezone: self.timezone.clone(),
            prompt: self.prompt.clone(),
            active: self.active,
        }
    }
}

/// What an administrator sets on a schedule.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct AgentScheduleDraft {
    pub name: String,
    pub cron: Option<String>,
    pub interval_minutes: Option<i64>,
    pub timezone: String,
    pub prompt: String,
    pub active: bool,
}

/// One agent's run of a schedule: `running`, `done`, `failed` or `skipped` (the previous run of the
/// same agent and schedule had not finished).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ScheduleRun {
    pub id: i64,
    pub schedule_id: i64,
    pub agent_id: i64,
    pub agent_name: Option<String>,
    pub status: String,
    pub output: Option<String>,
    pub error: Option<String>,
    pub started_at: i64,
    pub finished_at: Option<i64>,
}

pub const RUN_RUNNING: &str = "running";
pub const RUN_DONE: &str = "done";
pub const RUN_FAILED: &str = "failed";
pub const RUN_SKIPPED: &str = "skipped";
