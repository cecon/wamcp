//! Answers `pending` conversations of inboxes served by an `llm` bot: when the contact writes, the
//! conversation is sent to the bot's LLM provider and its reply goes out as the bot (handing off to
//! humans when the model asks to). Bursts are debounced and runs are limited; one run per
//! conversation at a time, with another one afterwards if the contact wrote meanwhile.
use super::event_bus::Envelope;
use super::helpdesk::HelpdeskService;
use super::ports::{Llm, LlmRequest};
use crate::domain::actor::Actor;
use crate::domain::error::{fail, Result};
use crate::domain::llm::{answer_schema, build_prompt, parse_answer, SYSTEM, TRANSCRIPT_LIMIT};
use crate::domain::model::{Message, BOT_LLM};
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
    debounce: Duration,
    slots: Arc<Semaphore>,
    /// Conversations with a scheduled or running answer; `true` = the contact wrote again meanwhile.
    queued: Arc<Mutex<HashMap<i64, bool>>>,
    running: Arc<AtomicUsize>,
    idle: Arc<Notify>,
}

impl LlmBotService {
    pub fn new(helpdesk: HelpdeskService, llm: Arc<dyn Llm>, debounce: Duration, concurrency: usize) -> Self {
        Self {
            helpdesk,
            llm,
            debounce,
            slots: Arc::new(Semaphore::new(concurrency.max(1))),
            queued: Arc::default(),
            running: Arc::default(),
            idle: Arc::default(),
        }
    }

    /// Bus listener: schedules an answer when a contact writes in a conversation an LLM bot serves.
    pub fn on_event(&self, envelope: &Envelope) {
        if envelope.event != "message.created" {
            return;
        }
        let Ok(message) = serde_json::from_value::<Message>(envelope.data.clone()) else {
            return;
        };
        if message.message_type != "incoming" || message.private || !self.serves(message.conversation_id) {
            return;
        }
        self.schedule(message.conversation_id);
    }

    fn serves(&self, conversation_id: i64) -> bool {
        let core = &self.helpdesk.core;
        let Ok(Some(conversation)) = core.repo.conversation_by_id(conversation_id) else {
            return false;
        };
        let bot_id = core.inbox(conversation.inbox_id).ok().and_then(|i| i.agent_bot_id);
        let bot = bot_id.and_then(|id| core.repo.agent_bot(id).ok().flatten());
        conversation.status == "pending" && bot.is_some_and(|b| b.kind == BOT_LLM)
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

    /// Asks the bot's provider for the next reply and sends it (or hands off) as the bot.
    async fn answer(&self, conversation_id: i64) -> Result<()> {
        let core = &self.helpdesk.core;
        let Some(conversation) = core.repo.conversation_by_id(conversation_id)? else {
            return Ok(());
        };
        let inbox = core.inbox(conversation.inbox_id)?;
        let bot = match inbox.agent_bot_id {
            Some(id) => core.repo.agent_bot(id)?,
            None => None,
        };
        let Some(bot) = bot.filter(|b| b.kind == BOT_LLM && conversation.status == "pending") else {
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
        let request = LlmRequest {
            provider: bot.provider.clone().unwrap_or_default(),
            model: bot.model.clone(),
            system: SYSTEM.into(),
            prompt: build_prompt(&inbox.name, bot.instructions.as_deref(), &messages),
            schema: answer_schema(),
        };
        let value = self.llm.complete(&request).await?;
        let Some(answer) = parse_answer(&value) else {
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
