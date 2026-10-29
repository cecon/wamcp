//! Schedules ("crons") AI agents subscribe to so they work by themselves, like Claude Code's `/loop`
//! (administrators): on each run every subscribed agent works on the task through its own runtime,
//! the output goes to the chat of the agent with the person who created the schedule, and each run
//! is kept in the history. The system agent is never scheduled. Runs are in `agent_schedules/runner.rs`.
mod runner;

use super::core::Core;
use super::llm_bots::LlmBotService;
use crate::domain::actor::Actor;
use crate::domain::agent_schedules::{check_subscriber, next_run, upcoming, validate_schedule, DEFAULT_TIMEZONE};
use crate::domain::error::{fail, HelpdeskError, Result};
use crate::domain::helpdesk::require_admin;
use crate::domain::model::{AgentSchedule, AgentScheduleDraft, ScheduleRun};
use parking_lot::Mutex;
use std::collections::HashSet;
use std::sync::atomic::AtomicUsize;
use std::sync::{Arc, OnceLock};
use tokio::sync::{Notify, Semaphore};

/// How many agents work on schedules at the same time.
const CONCURRENT_RUNS: usize = 2;
/// How many runs the history shows.
const HISTORY: i64 = 50;

/// What an administrator sends; absent fields keep their value (`cron`/`interval_minutes` may be
/// cleared with `null`; setting one clears the other).
#[derive(Debug, Clone, Default)]
pub struct ScheduleFields {
    pub name: Option<String>,
    pub cron: Option<Option<String>>,
    pub interval_minutes: Option<Option<i64>>,
    pub timezone: Option<String>,
    pub prompt: Option<String>,
    pub active: Option<bool>,
    pub agent_ids: Option<Vec<i64>>,
}

impl ScheduleFields {
    fn apply(&self, mut draft: AgentScheduleDraft) -> AgentScheduleDraft {
        if let Some(name) = &self.name {
            draft.name = name.trim().into();
        }
        match (&self.cron, self.interval_minutes) {
            (Some(cron), Some(minutes)) => (draft.cron, draft.interval_minutes) = (cron.clone(), minutes),
            (Some(Some(cron)), None) => (draft.cron, draft.interval_minutes) = (Some(cron.trim().into()), None),
            (Some(None), None) => draft.cron = None,
            (None, Some(Some(minutes))) => (draft.cron, draft.interval_minutes) = (None, Some(minutes)),
            (None, Some(None)) => draft.interval_minutes = None,
            (None, None) => {}
        }
        if let Some(timezone) = &self.timezone {
            draft.timezone = timezone.trim().into();
        }
        if let Some(prompt) = &self.prompt {
            draft.prompt = prompt.trim().into();
        }
        if let Some(active) = self.active {
            draft.active = active;
        }
        draft
    }
}

#[derive(Clone)]
pub struct AgentScheduleService {
    pub core: Core,
    /// Runs agents through their runtimes, once the server attached them.
    bots: Arc<OnceLock<LlmBotService>>,
    /// Agent and schedule pairs with a run going on.
    running: Arc<Mutex<HashSet<(i64, i64)>>>,
    slots: Arc<Semaphore>,
    pending: Arc<AtomicUsize>,
    idle: Arc<Notify>,
}

impl AgentScheduleService {
    pub fn new(core: Core) -> Self {
        Self {
            core,
            bots: Arc::default(),
            running: Arc::default(),
            slots: Arc::new(Semaphore::new(CONCURRENT_RUNS)),
            pending: Arc::default(),
            idle: Arc::default(),
        }
    }

    pub fn attach(&self, bots: LlmBotService) {
        let _ = self.bots.set(bots);
    }

    pub fn list(&self, actor: &Actor) -> Result<Vec<AgentSchedule>> {
        require_admin(actor)?;
        self.core.repo.agent_schedules()
    }

    fn find(&self, id: i64) -> Result<AgentSchedule> {
        self.core
            .repo
            .agent_schedule(id)?
            .ok_or_else(|| HelpdeskError::not_found("Agendamento não encontrado").into())
    }

    /// Checks every agent before subscribing any, so a bad one changes nothing.
    fn subscribers(&self, ids: &[i64]) -> Result<()> {
        for id in ids {
            match self.core.repo.agent(*id)? {
                Some(agent) => check_subscriber(&agent)?,
                None => return Err(HelpdeskError::not_found("Agente não encontrado").into()),
            }
        }
        Ok(())
    }

    fn save(&self, id: Option<i64>, actor: &Actor, draft: &AgentScheduleDraft, agents: Option<&[i64]>) -> Result<i64> {
        validate_schedule(draft)?;
        self.subscribers(agents.unwrap_or_default())?;
        let repo = &self.core.repo;
        let next = next_run(draft, self.core.clock.now_ms())?;
        let mut saved = 0;
        repo.transaction_dyn(&mut || {
            saved = match id {
                Some(id) => {
                    repo.update_agent_schedule(id, draft, next)?;
                    id
                }
                None => {
                    let Some(user) = actor.user_id() else {
                        return fail("Somente uma pessoa logada cria agendamentos");
                    };
                    repo.create_agent_schedule(draft, user, next, self.core.clock.now_ms())?
                }
            };
            if let Some(agents) = agents {
                for old in self.find(saved)?.agent_ids {
                    repo.set_schedule_agent(saved, old, false)?;
                }
                for agent in agents {
                    repo.set_schedule_agent(saved, *agent, true)?;
                }
            }
            Ok(())
        })?;
        Ok(saved)
    }

    pub fn create(&self, actor: &Actor, fields: &ScheduleFields) -> Result<AgentSchedule> {
        require_admin(actor)?;
        let blank = AgentScheduleDraft {
            timezone: DEFAULT_TIMEZONE.into(),
            active: true,
            ..AgentScheduleDraft::default()
        };
        let id = self.save(None, actor, &fields.apply(blank), fields.agent_ids.as_deref())?;
        self.find(id)
    }

    /// Changes the schedule; its next run is computed again from now.
    pub fn update(&self, actor: &Actor, id: i64, fields: &ScheduleFields) -> Result<AgentSchedule> {
        require_admin(actor)?;
        let draft = fields.apply(self.find(id)?.draft());
        self.save(Some(id), actor, &draft, fields.agent_ids.as_deref())?;
        self.find(id)
    }

    pub fn delete(&self, actor: &Actor, id: i64) -> Result<()> {
        require_admin(actor)?;
        self.find(id)?;
        self.core.repo.delete_agent_schedule(id)
    }

    /// Subscribes the agent to the schedule (`false` unsubscribes it).
    pub fn subscribe(&self, actor: &Actor, id: i64, agent_id: i64, subscribed: bool) -> Result<AgentSchedule> {
        require_admin(actor)?;
        self.find(id)?;
        if subscribed {
            self.subscribers(&[agent_id])?;
        }
        self.core.repo.set_schedule_agent(id, agent_id, subscribed)?;
        self.find(id)
    }

    /// The newest runs of the schedule, newest first.
    pub fn runs(&self, actor: &Actor, id: i64) -> Result<Vec<ScheduleRun>> {
        require_admin(actor)?;
        self.find(id)?;
        self.core.repo.schedule_runs(id, HISTORY)
    }

    /// The next runs of a schedule being edited (the cron helper), without saving anything.
    pub fn preview(&self, actor: &Actor, fields: &ScheduleFields) -> Result<Vec<i64>> {
        require_admin(actor)?;
        let draft = fields.apply(AgentScheduleDraft {
            name: "prévia".into(),
            prompt: "prévia".into(),
            timezone: DEFAULT_TIMEZONE.into(),
            active: true,
            ..AgentScheduleDraft::default()
        });
        validate_schedule(&draft)?;
        upcoming(&draft, self.core.clock.now_ms(), 5)
    }

    /// Runs the schedule now for every subscribed agent (its regular times do not change).
    pub fn run_now(&self, actor: &Actor, id: i64) -> Result<Vec<ScheduleRun>> {
        require_admin(actor)?;
        let schedule = self.find(id)?;
        if schedule.agent_ids.is_empty() {
            return fail("Nenhum agente inscrito neste agendamento");
        }
        self.launch(&schedule)
    }
}
