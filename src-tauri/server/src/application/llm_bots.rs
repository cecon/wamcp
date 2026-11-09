//! Answers the conversations assigned to the AI agent of an inbox (or the `pending` ones of a legacy
//! `llm` bot) through the agent's runtime, sending the reply as the inbox bot (handing off to humans
//! or resolving when the model asks to). Bursts are debounced, runs are limited and one run per
//! conversation at a time, once more if the contact wrote meanwhile. The same queue answers people's
//! chats with AI agents.
mod admin;
mod bridge;
mod chat;
mod conclude;
mod github_tools;
mod live;
mod record;
mod runs;
mod scheduled;
mod serves;
mod summary;

use super::event_bus::Envelope;
use super::helpdesk::HelpdeskService;
use super::ports::{Llm, LlmRequest, SecretBox};
use super::system_agent::SystemAgent;
use crate::domain::error::{fail, Result};
use crate::domain::github;
use crate::domain::llm::{
    agent_instructions, answer_schema, answers_customers, build_prompt, openrouter_key, parse_answer, SYSTEM,
    TRANSCRIPT_LIMIT,
};
use crate::domain::model::{ChatMessage, Inbox, Message, BOT_LLM, CHAT_USER};
use crate::domain::summary::with_summary;
use parking_lot::Mutex;
use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, OnceLock};
use std::time::Duration;
use tokio::sync::{Notify, Semaphore};

#[derive(Clone)]
pub struct LlmBotService {
    helpdesk: HelpdeskService,
    llm: Arc<dyn Llm>,
    secrets: Arc<dyn SecretBox>,
    debounce: Duration,
    slots: Arc<Semaphore>,
    /// Conversations and chats with a scheduled or running answer; `true` = someone wrote again meanwhile.
    queued: Arc<Mutex<HashMap<Target, live::Pending>>>,
    running: Arc<AtomicUsize>,
    idle: Arc<Notify>,
    system: Option<SystemAgent>,
    /// The app's own MCP endpoint for the system agent, known once the server listens.
    mcp_url: Arc<OnceLock<String>>,
    /// The agentic engine, for agents that run there (see `bridge.rs`).
    engine: Arc<OnceLock<super::engine::EngineService>>,
}

/// What an answer is for: a customer's conversation or a person's chat with an AI agent.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
enum Target {
    Conversation(i64),
    Chat(i64),
}

/// Who answers an inbox and the call to make: an AI agent of the roster or a legacy `llm` bot.
struct Responder {
    request: LlmRequest,
    agent_id: Option<i64>,
    agent_bot_id: Option<i64>,
}

impl LlmBotService {
    pub fn new(
        helpdesk: HelpdeskService,
        llm: Arc<dyn Llm>,
        secrets: Arc<dyn SecretBox>,
        debounce: Duration,
        concurrency: usize,
    ) -> Self {
        Self {
            helpdesk,
            llm,
            secrets,
            debounce,
            slots: Arc::new(Semaphore::new(concurrency.max(1))),
            queued: Arc::default(),
            running: Arc::default(),
            idle: Arc::default(),
            system: None,
            mcp_url: Arc::default(),
            engine: Arc::default(),
        }
    }

    /// Lets administrators talk to the system agent; `mcp_url` is filled when the server listens.
    pub fn with_system(mut self, system: SystemAgent, mcp_url: Arc<OnceLock<String>>) -> Self {
        self.system = Some(system);
        self.mcp_url = mcp_url;
        self
    }

    /// Sends the turns of agents that run on the engine through it, once it is attached.
    pub fn with_engine(mut self, engine: Arc<OnceLock<super::engine::EngineService>>) -> Self {
        self.engine = engine;
        self
    }

    /// Bus listener: schedules an answer when a contact writes in a conversation an LLM bot serves,
    /// when a person hands a conversation back to it (assigning it to the AI agent, or status
    /// `pending` for a legacy bot), or when a person writes in their chat with an AI agent.
    pub fn on_event(&self, envelope: &Envelope) {
        if envelope.event == "agent_chat.message" {
            if let Ok(m) = serde_json::from_value::<ChatMessage>(envelope.data.clone()) {
                if m.role == CHAT_USER {
                    self.schedule(Target::Chat(m.chat_id));
                }
            }
            return;
        }
        let conversation_id = match envelope.event.as_str() {
            "message.created" => match serde_json::from_value::<Message>(envelope.data.clone()) {
                Ok(m) if m.message_type == "incoming" && !m.private => m.conversation_id,
                _ => return,
            },
            "conversation.status_changed" if envelope.data["status"] == "pending" => {
                match envelope.data["id"].as_i64() {
                    Some(id) => id,
                    None => return,
                }
            }
            // A person handed the conversation (back) to the AI agent: it picks up where it is.
            "assignee.changed"
                if envelope.data["assignee_id"].is_null() && envelope.data["assignee_agent_id"].is_i64() =>
            {
                match envelope.data["id"].as_i64() {
                    Some(id) => id,
                    None => return,
                }
            }
            _ => return,
        };
        if self.serves(conversation_id) {
            self.schedule(Target::Conversation(conversation_id));
        }
    }

    fn serves(&self, conversation_id: i64) -> bool {
        let core = &self.helpdesk.core;
        let Ok(Some(conversation)) = core.repo.conversation_by_id(conversation_id) else {
            return false;
        };
        if matches!(self.system_target(&conversation), Ok(Some(_))) {
            return true;
        }
        let Ok(inbox) = core.inbox(conversation.inbox_id) else {
            return false;
        };
        let Ok(Some(responder)) = self.responder(&inbox) else {
            return false;
        };
        self.can_answer(&conversation, &responder)
    }

    /// Who answers the inbox: its AI agent (when it may answer customers), else its `llm` bot. The
    /// request carries the instructions as its prompt until the conversation is added.
    fn responder(&self, inbox: &Inbox) -> Result<Option<Responder>> {
        let repo = &self.helpdesk.core.repo;
        let agent = match inbox.ai_agent_id {
            Some(id) => repo.agent(id)?.filter(answers_customers),
            None => None,
        };
        let request = |provider: Option<String>, model, instructions: String, api_key| LlmRequest {
            provider: provider.unwrap_or_default(),
            model,
            system: SYSTEM.into(),
            prompt: instructions,
            schema: answer_schema(),
            api_key,
            mcp: None,
        };
        if let Some(agent) = agent {
            let credentials = repo.agent_sealed_credentials(agent.id)?;
            let api_key = match openrouter_key(&credentials) {
                Some(credential) => Some(self.secrets.open(&credential.secret)?),
                None => None,
            };
            let instructions = agent_instructions(&agent, &repo.skills()?);
            return Ok(Some(Responder {
                request: request(agent.runtime, agent.model, instructions, api_key),
                agent_id: Some(agent.id),
                agent_bot_id: None,
            }));
        }
        let bot = match inbox.agent_bot_id {
            Some(id) => repo.agent_bot(id)?.filter(|b| b.kind == BOT_LLM),
            None => None,
        };
        Ok(bot.map(|bot| Responder {
            agent_bot_id: Some(bot.id),
            agent_id: None,
            request: request(bot.provider, bot.model, bot.instructions.unwrap_or_default(), None),
        }))
    }

    /// Asks the agent's runtime for the next reply and sends it (or hands off) as the inbox bot.
    async fn answer(&self, conversation_id: i64) -> Result<()> {
        let core = &self.helpdesk.core;
        let Some(conversation) = core.repo.conversation_by_id(conversation_id)? else {
            return Ok(());
        };
        if let Some((agent, admin)) = self.system_target(&conversation)? {
            return self.answer_admin(&conversation, &agent, admin).await;
        }
        let inbox = core.inbox(conversation.inbox_id)?;
        let Some(responder) = self
            .responder(&inbox)?
            .filter(|responder| self.can_answer(&conversation, responder))
        else {
            return Ok(());
        };
        // A paused agent answers later, when it is resumed.
        if responder.agent_id.is_some_and(|id| self.paused(id)) {
            return Ok(());
        }
        let conversation = self.helpdesk.ensure_ai_responsible(&conversation)?;
        let messages = core.repo.messages(conversation.id, None, TRANSCRIPT_LIMIT)?;
        // Already answered (by a person or an earlier run): nothing new from the contact.
        let last = messages
            .iter()
            .rev()
            .find(|m| !m.private && m.message_type != "activity");
        if last.is_none_or(|m| m.message_type != "incoming") {
            return Ok(());
        }
        let mut request = responder.request.clone();
        request.prompt = match &inbox.github_repo {
            Some(repo) => {
                request.system = github::SYSTEM.into();
                github::build_prompt(repo, Some(&request.prompt), &messages)
            }
            None => build_prompt(&inbox.name, Some(&request.prompt), &messages),
        };
        let summary = self.earlier_summary(conversation.id, &messages, &responder).await;
        if let Some(agent) = responder.agent_id {
            if self
                .answer_by_engine(&conversation, &inbox, agent, summary.as_deref(), &messages)
                .await?
            {
                return Ok(());
            }
        }
        if let Some(summary) = summary {
            request.prompt = with_summary(&summary, &request.prompt);
        }
        let (completion, forwarded) = self
            .complete_for(&inbox, &conversation, request, responder.agent_id)
            .await?;
        self.record(&responder, Some(conversation.id), None, completion.usage);
        let Some(answer) = parse_answer(&completion.answer) else {
            return fail("Resposta da LLM fora do formato esperado");
        };
        self.conclude(&inbox, &conversation, &responder, answer, forwarded)
            .await
    }

    /// O vigia usa para pedir ao agente que decida de novo sobre uma conversa parada.
    pub(crate) fn nudge(&self, conversation_id: i64) {
        self.schedule(Target::Conversation(conversation_id));
    }

    /// Waits until no answer is scheduled or running (tests and shutdown).
    pub async fn settle(&self) {
        loop {
            let idle = self.idle.notified();
            if self.running.load(Ordering::Acquire) == 0 {
                return;
            }
            idle.await;
        }
    }
}
