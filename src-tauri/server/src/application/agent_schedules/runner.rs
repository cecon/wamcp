//! Runs schedules: every due schedule once per tick (a run missed while the app was off happens once,
//! not once per missed time), each subscribed agent in its own task. An agent still working on the
//! previous run of the same schedule skips this one; the output goes to the chat of the agent with
//! the person who created the schedule.
use super::AgentScheduleService;
use crate::application::agent_chats::post_chat_message;
use crate::domain::agent_schedules::{next_run, runs_schedules};
use crate::domain::error::{fail, Result};
use crate::domain::model::{
    AgentSchedule, ScheduleRun, CHAT_AGENT, CHAT_ERROR, RUN_DONE, RUN_FAILED, RUN_RUNNING, RUN_SKIPPED,
};
use std::sync::atomic::Ordering;

impl AgentScheduleService {
    /// After a restart: runs that were going on when the app stopped did not finish.
    pub fn recover(&self) -> Result<usize> {
        let now = self.core.clock.now_ms();
        self.core
            .repo
            .fail_unfinished_runs("O app foi fechado durante a execução", now)
    }

    /// Starts every due schedule and moves its next run past now.
    pub fn run_due(&self) -> Result<Vec<ScheduleRun>> {
        let now = self.core.clock.now_ms();
        let mut started = Vec::new();
        for schedule in self.core.repo.due_agent_schedules(now)? {
            let next = next_run(&schedule.draft(), now).unwrap_or(None);
            self.core.repo.mark_schedule_run(schedule.id, now, next)?;
            started.extend(self.launch(&schedule)?);
        }
        Ok(started)
    }

    /// One run per subscribed agent: started in the background, or skipped if the last one is going on.
    pub(super) fn launch(&self, schedule: &AgentSchedule) -> Result<Vec<ScheduleRun>> {
        let repo = &self.core.repo;
        let now = self.core.clock.now_ms();
        let mut runs = Vec::new();
        for agent_id in &schedule.agent_ids {
            let key = (schedule.id, *agent_id);
            if !self.running.lock().insert(key) {
                let run = repo.start_schedule_run(schedule.id, *agent_id, RUN_SKIPPED, now)?;
                let error = "A execução anterior deste agente ainda não terminou";
                runs.push(repo.finish_schedule_run(run.id, RUN_SKIPPED, None, Some(error), now)?);
                continue;
            }
            let run = match repo.start_schedule_run(schedule.id, *agent_id, RUN_RUNNING, now) {
                Ok(run) => run,
                Err(error) => {
                    self.running.lock().remove(&key);
                    return Err(error);
                }
            };
            runs.push(run.clone());
            self.pending.fetch_add(1, Ordering::AcqRel);
            let this = self.clone();
            let schedule = schedule.clone();
            tokio::spawn(async move {
                if let Err(error) = this.execute(&schedule, &run).await {
                    tracing::warn!(%error, schedule = schedule.id, run = run.id, "agendamento não registrado");
                }
                this.running.lock().remove(&key);
                if this.pending.fetch_sub(1, Ordering::AcqRel) == 1 {
                    this.idle.notify_waiters();
                }
            });
        }
        Ok(runs)
    }

    async fn work(&self, schedule: &AgentSchedule, run: &ScheduleRun) -> Result<String> {
        let Some(agent) = self.core.repo.agent(run.agent_id)? else {
            return fail("O agente não existe mais");
        };
        // Checked again at run time: the agent may have been turned off since it subscribed.
        if !runs_schedules(&agent) {
            return fail("o agente está inativo ou não pode ser agendado");
        }
        let Some(bots) = self.bots.get() else {
            return fail("os runtimes dos agentes ainda não foram carregados");
        };
        let _slot = self.slots.acquire().await;
        bots.run_scheduled(&agent, schedule, run.id).await
    }

    async fn execute(&self, schedule: &AgentSchedule, run: &ScheduleRun) -> Result<()> {
        let outcome = self.work(schedule, run).await;
        let repo = &self.core.repo;
        let now = self.core.clock.now_ms();
        let (role, message) = match &outcome {
            Ok(output) => {
                repo.finish_schedule_run(run.id, RUN_DONE, Some(output), None, now)?;
                (CHAT_AGENT, format!("⏰ {}\n\n{output}", schedule.name))
            }
            Err(error) => {
                repo.finish_schedule_run(run.id, RUN_FAILED, None, Some(&error.to_string()), now)?;
                (
                    CHAT_ERROR,
                    format!("⏰ {}: não consegui executar: {error}", schedule.name),
                )
            }
        };
        // The person who created it sees each run in their chat with the agent, as it finishes.
        let Some(user) = schedule.created_by else {
            return Ok(());
        };
        if repo.user(user)?.is_none_or(|u| u.active != 1) {
            return Ok(());
        }
        let chat = repo.agent_chat(user, run.agent_id)?;
        post_chat_message(&self.core, chat.id, role, &message)?;
        Ok(())
    }

    /// Waits until no run is going on (tests and shutdown).
    pub async fn settle(&self) {
        loop {
            let idle = self.idle.notified();
            if self.pending.load(Ordering::Acquire) == 0 {
                return;
            }
            idle.await;
        }
    }
}
