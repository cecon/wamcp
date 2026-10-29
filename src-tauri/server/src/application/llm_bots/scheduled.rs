//! An AI agent working on a schedule by itself (see `agent_schedules`): one call to its runtime with
//! its instructions and skills, the task and its latest outputs; the tokens count in its salary.
use super::{LlmBotService, Responder};
use crate::application::ports::LlmRequest;
use crate::domain::agent_schedules::{build_schedule_prompt, PREVIOUS_RUNS, SCHEDULE_SYSTEM};
use crate::domain::error::{fail, Result};
use crate::domain::llm::{agent_instructions, chat_schema, openrouter_key};
use crate::domain::model::{AgentSchedule, RosterAgent};

impl LlmBotService {
    /// The agent's output for this run of the schedule.
    pub async fn run_scheduled(&self, agent: &RosterAgent, schedule: &AgentSchedule, run_id: i64) -> Result<String> {
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
}
