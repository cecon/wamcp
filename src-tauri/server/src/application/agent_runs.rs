//! What the AI agents are doing right now, in memory: every answer, chat turn and scheduled run
//! registers here while it waits and runs, and each change goes to the bus (`agent_run.updated`,
//! `agent_run.finished`) so the "Em execução" screen follows it live.
use super::core::Core;
use super::engine::EngineService;
use super::event_bus::EventBus;
use crate::domain::actor::{Actor, Performer};
use crate::domain::error::Result;
use crate::domain::model::{run_visible, AgentRun, RUN_ACTIVE, RUN_QUEUED};
use parking_lot::Mutex;
use serde_json::json;
use std::collections::HashMap;
use std::sync::Arc;

/// Steps closer than this to the last one update the run without a new event.
const STEP_EVENT_MS: i64 = 1500;

pub struct AgentRuns {
    runs: Mutex<HashMap<String, (AgentRun, i64)>>,
    bus: Arc<EventBus>,
}

fn now() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

impl AgentRuns {
    pub fn new(bus: Arc<EventBus>) -> Self {
        Self {
            runs: Mutex::default(),
            bus,
        }
    }

    fn emit(&self, event: &str, run: &AgentRun) {
        let data = serde_json::to_value(run).unwrap_or_else(|_| json!({ "id": run.id }));
        self.bus.emit(event, data, Performer::system());
    }

    /// Adds a run waiting to start (its `state` and times are set here).
    pub fn queue(&self, mut run: AgentRun) {
        let at = now();
        (run.state, run.queued_at, run.started_at, run.updated_at) = (RUN_QUEUED.into(), at, None, at);
        self.runs.lock().insert(run.id.clone(), (run.clone(), at));
        self.emit("agent_run.updated", &run);
    }

    /// Applies `change` to a run going on and tells the bus (always, or throttled for steps).
    fn change(&self, id: &str, throttle: bool, change: impl FnOnce(&mut AgentRun)) {
        let at = now();
        let run = {
            let mut runs = self.runs.lock();
            let Some((run, emitted)) = runs.get_mut(id) else {
                return;
            };
            change(run);
            run.updated_at = at;
            if throttle && at - *emitted < STEP_EVENT_MS {
                return;
            }
            *emitted = at;
            run.clone()
        };
        self.emit("agent_run.updated", &run);
    }

    pub fn start(&self, id: &str) {
        self.change(id, false, |run| {
            run.state = RUN_ACTIVE.into();
            run.started_at = Some(now());
            run.detail = None;
            run.again = false;
        });
    }

    /// Back to the queue: someone wrote again while it ran, so it runs once more.
    pub fn requeue(&self, id: &str) {
        self.change(id, false, |run| {
            run.state = RUN_QUEUED.into();
            run.again = false;
        });
    }

    pub fn again(&self, id: &str) {
        self.change(id, false, |run| run.again = true);
    }

    pub fn step(&self, id: &str, detail: &str) {
        let detail: String = detail.chars().take(160).collect();
        self.change(id, true, |run| run.detail = Some(detail));
    }

    pub fn finish(&self, id: &str) {
        let Some((run, _)) = self.runs.lock().remove(id) else {
            return;
        };
        self.emit("agent_run.finished", &run);
    }

    pub fn contains(&self, id: &str) -> bool {
        self.runs.lock().contains_key(id)
    }

    /// The runs a person may see, oldest first.
    pub fn visible(&self, user_id: i64, admin: bool, inboxes: &[i64]) -> Vec<AgentRun> {
        let mut runs: Vec<AgentRun> = self
            .runs
            .lock()
            .values()
            .map(|(run, _)| run)
            .filter(|run| run_visible(run.owner_id, run.inbox_id, user_id, admin, inboxes))
            .cloned()
            .collect();
        runs.sort_by_key(|run| run.queued_at);
        runs
    }
}

/// Everything at work a person may see: the runs of this process and, for administrators, the
/// engine's unfinished activities. Oldest first.
pub fn runs_for(core: &Core, engine: Option<&EngineService>, actor: &Actor) -> Result<Vec<AgentRun>> {
    let Actor::User(user) = actor else {
        return Ok(Vec::new());
    };
    let admin = actor.is_admin();
    let inboxes = if admin {
        Vec::new()
    } else {
        core.member_inbox_ids(actor)?
    };
    let mut runs = core.runs.visible(user.id, admin, &inboxes);
    if let (true, Some(engine)) = (admin, engine) {
        runs.extend(engine.active_runs(user.account_id)?);
        runs.sort_by_key(|run| run.queued_at);
    }
    Ok(runs)
}
