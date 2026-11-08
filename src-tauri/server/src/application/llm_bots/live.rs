//! The answer queue of the AI agents and its live controls. A conversation waits for an answer
//! while it is `pending` and its last public message is the contact's, so the queue is the
//! conversations' own state and survives a restart (`recover`). Administrators see what each agent
//! is doing in "Agentes ao vivo" (the run registry), pause an agent (it answers nothing until
//! resumed) and stop an answer, which hands the conversation to a person.
use super::{runs, LlmBotService, Target};
use crate::domain::actor::Actor;
use crate::domain::error::{fail_with, Result};
use crate::domain::helpdesk::require_admin;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use tokio::sync::Notify;

/// A scheduled or running answer.
pub(super) struct Pending {
    /// Someone wrote again meanwhile: answer once more afterwards.
    again: bool,
    stop: Arc<Notify>,
}

impl LlmBotService {
    pub(super) fn schedule(&self, target: Target) {
        let run = runs::run_id(target);
        let stop = {
            let mut queued = self.queued.lock();
            if let Some(pending) = queued.get_mut(&target) {
                pending.again = true;
                self.helpdesk.core.runs.again(&run);
                return;
            }
            let stop = Arc::new(Notify::new());
            queued.insert(
                target,
                Pending {
                    again: false,
                    stop: stop.clone(),
                },
            );
            stop
        };
        self.track(target);
        self.running.fetch_add(1, Ordering::AcqRel);
        let this = self.clone();
        tokio::spawn(async move {
            loop {
                let turn = async {
                    tokio::time::sleep(this.debounce).await;
                    this.set_again(target, false);
                    let _slot = this.slots.acquire().await;
                    this.helpdesk.core.runs.start(&run);
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
                if !this.queued.lock().get(&target).is_some_and(|pending| pending.again) {
                    break;
                }
                this.helpdesk.core.runs.requeue(&run);
            }
            {
                // Under the queue's lock: a new message right after this registers a new run.
                let mut queued = this.queued.lock();
                queued.remove(&target);
                this.helpdesk.core.runs.finish(&run);
            }
            if this.running.fetch_sub(1, Ordering::AcqRel) == 1 {
                this.idle.notify_waiters();
            }
        });
    }

    fn set_again(&self, target: Target, again: bool) {
        if let Some(pending) = self.queued.lock().get_mut(&target) {
            pending.again = again;
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
        let theirs = conversation.assignee_agent_id.is_some() || conversation.status == "pending";
        if conversation.assignee_id.is_none() && theirs {
            let reason = "atendimento da IA encerrado por um administrador";
            self.helpdesk.handoff_to_human(actor, &conversation, reason)?;
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
}
