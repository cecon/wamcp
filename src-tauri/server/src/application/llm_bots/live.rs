//! The answer queue of the AI agents and its live controls. A conversation waits for an answer
//! while it is `pending` and its last public message is the contact's, so the queue is the
//! conversations' own state and survives a restart (`recover`). Administrators see what each agent
//! is doing, pause an agent (it answers nothing until resumed) and stop an answer, which hands the
//! conversation to the people of the inbox.
use super::{LlmBotService, Target};
use crate::domain::actor::Actor;
use crate::domain::error::{fail_with, Result};
use crate::domain::helpdesk::require_admin;
use serde::Serialize;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use tokio::sync::Notify;

/// A scheduled or running answer.
pub(super) struct Pending {
    /// Someone wrote again meanwhile: answer once more afterwards.
    again: bool,
    /// When the current answer started (`None`: waiting for the debounce or a free slot).
    since: Option<i64>,
    stop: Arc<Notify>,
}

/// One answer in the live view.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct LiveAnswer {
    /// `conversation` or `chat`.
    pub kind: &'static str,
    pub id: i64,
    /// The conversation's number in the app (conversations only).
    pub display_id: Option<i64>,
    pub agent_id: Option<i64>,
    pub running: bool,
    pub since: Option<i64>,
}

impl LlmBotService {
    pub(super) fn schedule(&self, target: Target) {
        let stop = {
            let mut queued = self.queued.lock();
            if let Some(pending) = queued.get_mut(&target) {
                pending.again = true;
                return;
            }
            let stop = Arc::new(Notify::new());
            let pending = Pending {
                again: false,
                since: None,
                stop: stop.clone(),
            };
            queued.insert(target, pending);
            stop
        };
        self.running.fetch_add(1, Ordering::AcqRel);
        let this = self.clone();
        tokio::spawn(async move {
            loop {
                let turn = async {
                    tokio::time::sleep(this.debounce).await;
                    let _slot = this.slots.acquire().await;
                    this.mark_running(target);
                    match target {
                        Target::Conversation(id) => this.answer(id).await,
                        Target::Chat(id) => this.answer_chat(id).await,
                    }
                };
                let outcome = tokio::select! {
                    () = stop.notified() => break,
                    outcome = turn => outcome,
                };
                if let Err(error) = outcome {
                    tracing::warn!(%error, ?target, "robô de LLM não respondeu");
                }
                let mut queued = this.queued.lock();
                match queued.get_mut(&target) {
                    Some(pending) if pending.again => {
                        pending.again = false;
                        pending.since = None;
                    }
                    _ => break,
                }
            }
            this.queued.lock().remove(&target);
            if this.running.fetch_sub(1, Ordering::AcqRel) == 1 {
                this.idle.notify_waiters();
            }
        });
    }

    fn mark_running(&self, target: Target) {
        if let Some(pending) = self.queued.lock().get_mut(&target) {
            pending.since = Some(self.helpdesk.core.clock.now_ms());
            pending.again = false;
        }
    }

    /// Startup and resume: answers every conversation still waiting for its agent.
    pub fn recover(&self) -> Result<usize> {
        let waiting = self.helpdesk.core.repo.unanswered_conversations()?;
        let mut scheduled = 0;
        for id in waiting {
            if self.serves(id) {
                self.schedule(Target::Conversation(id));
                scheduled += 1;
            }
        }
        Ok(scheduled)
    }

    pub(super) fn paused(&self, agent_id: i64) -> bool {
        let paused = self.helpdesk.core.repo.paused_agents();
        paused.is_ok_and(|ids| ids.contains(&agent_id))
    }

    /// Pauses an AI agent (its conversations wait) or resumes it (they are answered now).
    pub fn set_paused(&self, actor: &Actor, agent_id: i64, paused: bool) -> Result<()> {
        require_admin(actor)?;
        let repo = &self.helpdesk.core.repo;
        if repo.agent(agent_id)?.is_none_or(|a| a.kind != "ai") {
            return fail_with("Agente de IA não encontrado", 404);
        }
        repo.set_agent_paused(agent_id, paused)?;
        if !paused {
            self.recover()?;
        }
        Ok(())
    }

    /// Stops the agent's answer in a conversation and hands the conversation to people.
    pub async fn stop_conversation(&self, actor: &Actor, conversation_id: i64) -> Result<()> {
        require_admin(actor)?;
        let core = &self.helpdesk.core;
        let Some(conversation) = core.repo.conversation_by_id(conversation_id)? else {
            return fail_with("Conversa não encontrada", 404);
        };
        self.stop(Target::Conversation(conversation_id));
        if conversation.status == "pending" {
            let bot = Actor::Bot {
                inbox_id: conversation.inbox_id,
            };
            self.helpdesk
                .toggle_status(&bot, conversation.display_id, "open", None)?;
        }
        Ok(())
    }

    /// Stops the answer being written in a person's chat with an agent.
    pub fn stop_chat(&self, actor: &Actor, chat_id: i64) -> Result<()> {
        require_admin(actor)?;
        self.stop(Target::Chat(chat_id));
        Ok(())
    }

    fn stop(&self, target: Target) {
        if let Some(pending) = self.queued.lock().get(&target) {
            pending.stop.notify_one();
        }
    }

    /// What the agents are answering now, oldest first.
    pub fn live(&self, actor: &Actor) -> Result<Vec<LiveAnswer>> {
        require_admin(actor)?;
        let snapshot: Vec<(Target, Option<i64>)> = self.queued.lock().iter().map(|(t, p)| (*t, p.since)).collect();
        let repo = &self.helpdesk.core.repo;
        let mut answers = Vec::new();
        for (target, since) in snapshot {
            let (kind, id, display_id, agent_id) = match target {
                Target::Conversation(id) => {
                    let Some(conversation) = repo.conversation_by_id(id)? else {
                        continue;
                    };
                    let agent = self.helpdesk.core.inbox(conversation.inbox_id)?.ai_agent_id;
                    ("conversation", id, Some(conversation.display_id), agent)
                }
                Target::Chat(id) => {
                    let agent = repo.agent_chat_by_id(id)?.map(|c| c.agent_id);
                    ("chat", id, None, agent)
                }
            };
            answers.push(LiveAnswer {
                kind,
                id,
                display_id,
                agent_id,
                running: since.is_some(),
                since,
            });
        }
        answers.sort_by_key(|a| (a.since.unwrap_or(i64::MAX), a.id));
        Ok(answers)
    }
}
