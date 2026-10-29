//! Answers `pending` conversations of inboxes served by an AI agent of the roster (or a legacy `llm`
//! bot): when the contact writes, the conversation is sent to the agent's runtime with its model,
//! instructions and skills, and the reply goes out as the inbox bot (handing off to humans when the
//! model asks to). Bursts are debounced and runs are limited; one run per
//! conversation at a time, with another one afterwards if the contact wrote meanwhile. The same queue
//! answers the chats people logged in to the app have with AI agents (`chat`).
mod admin;
mod chat;

use super::event_bus::Envelope;
use super::helpdesk::HelpdeskService;
use super::ports::{Llm, LlmRequest, SecretBox, TokenUsage};
use super::system_agent::SystemAgent;
use crate::domain::actor::Actor;
use crate::domain::error::{fail, Result};
use crate::domain::github;
use crate::domain::llm::{
    agent_instructions, answer_schema, answers_customers, build_prompt, openrouter_key, parse_answer, SYSTEM,
    TRANSCRIPT_LIMIT,
};
use crate::domain::model::{ChatMessage, Inbox, LlmUsage, Message, BOT_LLM, CHAT_USER};
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
    queued: Arc<Mutex<HashMap<Target, bool>>>,
    running: Arc<AtomicUsize>,
    idle: Arc<Notify>,
    system: Option<SystemAgent>,
    /// The app's own MCP endpoint for the system agent, known once the server listens.
    mcp_url: Arc<OnceLock<String>>,
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
        }
    }

    /// Lets administrators talk to the system agent; `mcp_url` is filled when the server listens.
    pub fn with_system(mut self, system: SystemAgent, mcp_url: Arc<OnceLock<String>>) -> Self {
        self.system = Some(system);
        self.mcp_url = mcp_url;
        self
    }

    /// Bus listener: schedules an answer when a contact writes in a conversation an LLM bot serves,
    /// when a person hands an open conversation back to it (status `pending`), or when a person
    /// writes in their chat with an AI agent.
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
        let inbox = core.inbox(conversation.inbox_id);
        conversation.status == "pending" && inbox.is_ok_and(|i| matches!(self.responder(&i), Ok(Some(_))))
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

    fn schedule(&self, target: Target) {
        {
            let mut queued = self.queued.lock();
            if let Some(again) = queued.get_mut(&target) {
                *again = true;
                return;
            }
            queued.insert(target, false);
        }
        self.running.fetch_add(1, Ordering::AcqRel);
        let this = self.clone();
        tokio::spawn(async move {
            loop {
                tokio::time::sleep(this.debounce).await;
                this.queued.lock().insert(target, false);
                if let Ok(_slot) = this.slots.acquire().await {
                    let outcome = match target {
                        Target::Conversation(id) => this.answer(id).await,
                        Target::Chat(id) => this.answer_chat(id).await,
                    };
                    if let Err(error) = outcome {
                        tracing::warn!(%error, ?target, "robô de LLM não respondeu");
                    }
                }
                let mut queued = this.queued.lock();
                if queued.get(&target) != Some(&true) {
                    queued.remove(&target);
                    break;
                }
            }
            if this.running.fetch_sub(1, Ordering::AcqRel) == 1 {
                this.idle.notify_waiters();
            }
        });
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
        let Some(responder) = self.responder(&inbox)?.filter(|_| conversation.status == "pending") else {
            return Ok(());
        };
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
        let completion = self.llm.complete(&request).await?;
        self.record(&responder, Some(conversation.id), None, completion.usage);
        let Some(answer) = parse_answer(&completion.answer) else {
            return fail("Resposta da LLM fora do formato esperado");
        };
        // A person may have taken the conversation while the model was thinking.
        let current = core.repo.conversation_by_id(conversation_id)?;
        if current.is_none_or(|c| c.status != "pending") {
            return Ok(());
        }
        let actor = Actor::Bot { inbox_id: inbox.id };
        if !answer.reply.is_empty() {
            self.helpdesk
                .reply(&actor, conversation.display_id, &answer.reply, false)
                .await?;
        }
        if answer.handoff {
            self.helpdesk
                .toggle_status(&actor, conversation.display_id, "open", None)?;
        }
        Ok(())
    }

    /// Keeps the tokens of the call: an AI agent's salary is the cost of its calls plus the margin.
    /// `run_ref` names what the call was for when it is not a conversation (`agent_chat:<id>`).
    fn record(&self, responder: &Responder, conversation_id: Option<i64>, run_ref: Option<String>, usage: TokenUsage) {
        let usage = LlmUsage {
            agent_id: responder.agent_id,
            agent_bot_id: responder.agent_bot_id,
            conversation_id,
            run_ref,
            provider: responder.request.provider.clone(),
            model: responder.request.model.clone(),
            input_tokens: usage.input_tokens,
            cached_tokens: usage.cached_input_tokens,
            output_tokens: usage.output_tokens,
            cost: usage.cost_usd,
            currency: "USD".into(),
            cost_reported: usage.cost_usd.is_some(),
            at: self.helpdesk.core.clock.now_ms(),
        };
        if let Err(error) = self.helpdesk.core.repo.record_llm_usage(&usage) {
            tracing::warn!(%error, ?conversation_id, "uso de tokens não registrado");
        }
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
