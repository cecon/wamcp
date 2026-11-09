//! An AI agent working on a schedule by itself (see `agent_schedules`): one call to its runtime with
//! its instructions and skills, the task and its latest outputs; the tokens count in its salary.
use super::{LlmBotService, Responder};
use crate::application::engine::Submission;
use crate::application::ports::LlmRequest;
use crate::domain::agent_schedules::{build_schedule_prompt, PREVIOUS_RUNS, SCHEDULE_SYSTEM};
use crate::domain::bridge::REQUEST_LIMIT;
use crate::domain::engine::activity as status;
use crate::domain::engine::recipients;
use crate::domain::error::{fail, Result};
use crate::domain::llm::{agent_instructions, chat_schema, openrouter_key};
use crate::domain::model::{AgentSchedule, RosterAgent};

impl LlmBotService {
    /// The agent's output for this run of the schedule.
    pub async fn run_scheduled(&self, agent: &RosterAgent, schedule: &AgentSchedule, run_id: i64) -> Result<String> {
        if let Some(output) = self.run_scheduled_by_engine(agent, schedule, run_id).await? {
            return Ok(output);
        }
        let repo = &self.helpdesk.core.repo;
        let credentials = repo.agent_sealed_credentials(agent.id)?;
        let api_key = match openrouter_key(&credentials) {
            Some(credential) => Some(self.secrets.open(&credential.secret)?),
            None => None,
        };
        let instructions = agent_instructions(agent, &repo.skills()?);
        let previous = repo.schedule_outputs(schedule.id, agent.id, PREVIOUS_RUNS)?;
        let request = LlmRequest {
            provider: agent.runtime.clone().unwrap_or_default(),
            model: agent.model.clone(),
            system: SCHEDULE_SYSTEM.into(),
            prompt: build_schedule_prompt(&instructions, &schedule.name, &schedule.prompt, &previous),
            schema: chat_schema(),
            api_key,
            mcp: None,
        };
        let completion = self.llm.complete(&request).await?;
        let responder = Responder {
            request,
            agent_id: Some(agent.id),
            agent_bot_id: None,
        };
        self.record(
            &responder,
            None,
            Some(format!("agent_schedule_run:{run_id}")),
            completion.usage,
        );
        let reply = completion.answer["reply"].as_str().map(str::trim).unwrap_or_default();
        if reply.is_empty() {
            return fail("o agente respondeu sem mensagem");
        }
        Ok(reply.into())
    }

    /// Agents that run on the engine work the schedule there, with their plugins' tools (the
    /// internal-only ones too: nobody outside wrote this task). `None`: run directly instead.
    async fn run_scheduled_by_engine(
        &self,
        agent: &RosterAgent,
        schedule: &AgentSchedule,
        run_id: i64,
    ) -> Result<Option<String>> {
        let Some(engine) = self.engine.get().cloned() else {
            return Ok(None);
        };
        // Each installation is one company: the account created by the first migration.
        let account = 1;
        let on_engine = agent.runtime.as_deref().is_some_and(|r| engine.has_runtime(r));
        if !on_engine || !engine.store.policy(account, agent.id)?.enabled {
            return Ok(None);
        }
        let previous = self
            .helpdesk
            .core
            .repo
            .schedule_outputs(schedule.id, agent.id, PREVIOUS_RUNS)?;
        let task = build_schedule_prompt("", &schedule.name, &schedule.prompt, &previous);
        let submission = Submission {
            account_id: account,
            agent_id: agent.id,
            request: task.chars().take(REQUEST_LIMIT).collect(),
            requester: format!("schedule:{}", schedule.id),
            idempotency_key: Some(format!("agent_schedule_run:{run_id}")),
            ..Submission::default()
        };
        let (activity, _) = engine.submit(&submission)?;
        let id = activity.id;
        let driver = {
            let engine = engine.clone();
            tokio::spawn(async move { engine.execute(account, id).await })
        };
        let done = match driver.await {
            Ok(done) => done?,
            Err(error) => return fail(format!("Execução do motor interrompida: {error}")),
        };
        match (done.status.as_str(), done.result) {
            (status::COMPLETED, Some(result)) => Ok(Some(result)),
            (status::WAITING_APPROVAL, _) => {
                // The runner posts this wait to the creator now; the result, after the approval,
                // reaches them through the request's recipients.
                if let Some(user) = schedule.created_by {
                    let told = Some(status::WAITING_APPROVAL);
                    engine
                        .store
                        .add_recipient(account, id, recipients::USER, user, false, told)?;
                }
                Ok(Some(format!(
                    "Aguardando a aprovação de uma pessoa para continuar (pedido #{id}, em Motor de agentes). \
                     O resultado chega aqui quando ela for decidida."
                )))
            }
            _ => fail(done.error.unwrap_or_else(|| "o pedido do motor não terminou".into())),
        }
    }
}
