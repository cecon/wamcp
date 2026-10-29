use crate::domain::error::Result;
use crate::domain::model::{AgentSchedule, AgentScheduleDraft, ScheduleRun};

/// The schedules AI agents subscribe to, who subscribed and the history of their runs.
pub trait AgentScheduleRepo {
    /// Every schedule with its subscribed agents, by name.
    fn agent_schedules(&self) -> Result<Vec<AgentSchedule>>;
    fn agent_schedule(&self, id: i64) -> Result<Option<AgentSchedule>>;
    fn create_agent_schedule(
        &self,
        draft: &AgentScheduleDraft,
        created_by: i64,
        next_run_at: Option<i64>,
        at: i64,
    ) -> Result<i64>;
    fn update_agent_schedule(&self, id: i64, draft: &AgentScheduleDraft, next_run_at: Option<i64>) -> Result<()>;
    fn delete_agent_schedule(&self, id: i64) -> Result<()>;
    /// Subscribes (`true`) or unsubscribes the agent; doing it twice changes nothing.
    fn set_schedule_agent(&self, schedule_id: i64, agent_id: i64, subscribed: bool) -> Result<()>;
    /// Active schedules whose next run is at or before `now`.
    fn due_agent_schedules(&self, now: i64) -> Result<Vec<AgentSchedule>>;
    fn mark_schedule_run(&self, id: i64, last_run_at: i64, next_run_at: Option<i64>) -> Result<()>;
    fn start_schedule_run(&self, schedule_id: i64, agent_id: i64, status: &str, at: i64) -> Result<ScheduleRun>;
    fn finish_schedule_run(
        &self,
        id: i64,
        status: &str,
        output: Option<&str>,
        error: Option<&str>,
        at: i64,
    ) -> Result<ScheduleRun>;
    /// The newest `limit` runs of the schedule, newest first.
    fn schedule_runs(&self, schedule_id: i64, limit: i64) -> Result<Vec<ScheduleRun>>;
    /// The newest finished runs of the agent for the schedule that produced an output, newest first.
    fn schedule_outputs(&self, schedule_id: i64, agent_id: i64, limit: i64) -> Result<Vec<ScheduleRun>>;
    /// Runs left `running` when the app stopped become `failed`; returns how many.
    fn fail_unfinished_runs(&self, error: &str, at: i64) -> Result<usize>;
}
