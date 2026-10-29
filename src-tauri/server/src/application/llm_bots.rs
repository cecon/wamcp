//! Answers `pending` conversations of inboxes served by an AI agent of the roster (or a legacy `llm`
//! bot): when the contact writes, the conversation is sent to the agent's runtime with its model,
//! instructions and skills, and the reply goes out as the inbox bot (handing off to humans when the
//! model asks to). Bursts are debounced and runs are limited; one run per
//! conversation at a time, with another one afterwards if the contact wrote meanwhile.
use super::event_bus::Envelope;
use super::helpdesk::HelpdeskService;
use super::ports::{Llm, LlmRequest, SecretBox, TokenUsage};
use crate::domain::actor::Actor;
use crate::domain::error::{fail, Result};
use crate::domain::llm::{
    agent_instructions, answer_schema, answers_customers, build_prompt, openrouter_key, parse_answer, SYSTEM,
    TRANSCRIPT_LIMIT,
};
use crate::domain::model::{Inbox, LlmUsage, Message, BOT_LLM};
use parking_lot::Mutex;
use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{Notify, Semaphore};

#[derive(Clone)]
pub struct LlmBotService {
    helpdesk: HelpdeskService,
    llm: Arc<dyn Llm>,
    secrets: Arc<dyn SecretBox>,
    debounce: Duration,
    slots: Arc<Semaphore>,
    /// Conversations with a scheduled or running answer; `true` = the contact wrote again meanwhile.
    queued: Arc<Mutex<HashMap<i64, bool>>>,
    running: Arc<AtomicUsize>,
    idle: Arc<Notify>,
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
        }
    }

    /// Bus listener: schedules an answer when a contact writes in a conversation an LLM bot serves,
    /// or when a person hands an open conversation back to it (status `pending`).
    pub fn on_event(&self, envelope: &Envelope) {
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
            self.schedule(conversation_id);
        }
    }

    fn serves(&self, conversation_id: i64) -> bool {
        let core = &self.helpdesk.core;
        let Ok(Some(conversation)) = core.repo.conversation_by_id(conversation_id) else {
            return false;
        };
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

    fn schedule(&self, conversation_id: i64) {
        {
            let mut queued = self.queued.lock();
            if let Some(again) = queued.get_mut(&conversation_id) {
                *again = true;
                return;
            }
            queued.insert(conversation_id, false);
        }
        self.running.fetch_add(1, Ordering::AcqRel);
        let this = self.clone();
        tokio::spawn(async move {
            loop {
                tokio::time::sleep(this.debounce).await;
                this.queued.lock().insert(conversation_id, false);
                if let Ok(_slot) = this.slots.acquire().await {
                    if let Err(error) = this.answer(conversation_id).await {
                        tracing::warn!(%error, conversation_id, "robô de LLM não respondeu");
                    }
                }
                let mut queued = this.queued.lock();
                if queued.get(&conversation_id) != Some(&true) {
                    queued.remove(&conversation_id);
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
        request.prompt = build_prompt(&inbox.name, Some(&request.prompt), &messages);
        let completion = self.llm.complete(&request).await?;
        self.record(&responder, conversation.id, completion.usage);
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
    fn record(&self, responder: &Responder, conversation_id: i64, usage: TokenUsage) {
        let usage = LlmUsage {
            agent_id: responder.agent_id,
            agent_bot_id: responder.agent_bot_id,
            conversation_id: Some(conversation_id),
            run_ref: None,
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
            tracing::warn!(%error, conversation_id, "uso de tokens não registrado");
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
