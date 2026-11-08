//! The controls of "Agentes ao vivo": pause and resume an AI agent, stop its answer in a
//! conversation or chat (the engine request answering it too). What runs now is `agent_runs`.
use super::engine::EngineService;
use super::llm_bots::LlmBotService;
use super::ports::Repository;
use crate::domain::actor::Actor;
use crate::domain::engine::activity as status;
use crate::domain::error::{fail_with, Result};
use crate::domain::helpdesk::require_admin;
use serde::Serialize;
use std::sync::{Arc, OnceLock};

/// An AI agent and whether it is paused. What it works on is in the run registry (`/agent_runs`).
#[derive(Debug, Serialize)]
pub struct LiveAgent {
    pub id: i64,
    pub name: String,
    pub active: bool,
    pub paused: bool,
}

#[derive(Clone)]
pub struct LiveService {
    repo: Arc<dyn Repository>,
    answers: Arc<OnceLock<LlmBotService>>,
    engine: Arc<OnceLock<EngineService>>,
}

impl LiveService {
    pub fn new(
        repo: Arc<dyn Repository>,
        answers: Arc<OnceLock<LlmBotService>>,
        engine: Arc<OnceLock<EngineService>>,
    ) -> Self {
        Self { repo, answers, engine }
    }

    fn answers(&self) -> Result<&LlmBotService> {
        match self.answers.get() {
            Some(answers) => Ok(answers),
            None => fail_with("Os agentes de IA não estão ativos", 503),
        }
    }

    pub fn overview(&self, actor: &Actor) -> Result<Vec<LiveAgent>> {
        require_admin(actor)?;
        let paused = self.repo.paused_agents()?;
        let agents = self.repo.agents()?.into_iter().filter(|a| a.kind == "ai");
        Ok(agents
            .map(|agent| LiveAgent {
                paused: paused.contains(&agent.id),
                id: agent.id,
                name: agent.name,
                active: agent.active,
            })
            .collect())
    }

    /// Pauses or resumes an AI agent, for its conversations and its engine requests alike.
    pub fn set_paused(&self, actor: &Actor, agent_id: i64, paused: bool) -> Result<()> {
        require_admin(actor)?;
        match self.answers.get() {
            Some(answers) => answers.set_paused(actor, agent_id, paused)?,
            None => self.repo.set_agent_paused(agent_id, paused)?,
        }
        if let (false, Some(engine)) = (paused, self.engine.get()) {
            engine.resume_agent(agent_id)?;
        }
        Ok(())
    }

    /// Stops the answer (and the engine request answering it, if any) and hands the conversation to people.
    pub async fn stop_conversation(&self, actor: &Actor, conversation_id: i64) -> Result<()> {
        require_admin(actor)?;
        // The engine first, so a request finishing right now cannot still post its answer.
        if let (Some(engine), Some(conversation)) = (self.engine.get(), self.repo.conversation_by_id(conversation_id)?)
        {
            let account = conversation.account_id;
            for activity in engine.store.activities(account, 200)? {
                let open = !status::is_final(&activity.status) && activity.parent_id.is_none();
                if open && activity.conversation_id == Some(conversation_id) {
                    engine.cancel(account, activity.id).await?;
                }
            }
        }
        self.answers()?.stop_conversation(actor, conversation_id).await
    }

    pub fn stop_chat(&self, actor: &Actor, chat_id: i64) -> Result<()> {
        self.answers()?.stop_chat(actor, chat_id)
    }
}
