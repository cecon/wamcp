//! The answers of this queue as runs of "Em execução": what each one works on, registered while it
//! waits for its debounce or a free slot and while the runtime works, with the runtime's last step.
use super::{LlmBotService, Target};
use crate::application::ports::Progress;
use crate::domain::error::Result;
use crate::domain::model::{AgentRun, RUN_CHAT, RUN_CONVERSATION};

pub(super) fn run_id(target: Target) -> String {
    match target {
        Target::Conversation(id) => format!("{RUN_CONVERSATION}:{id}"),
        Target::Chat(id) => format!("{RUN_CHAT}:{id}"),
    }
}

/// A runtime step, for people.
pub(crate) fn step_text(step: &Progress) -> String {
    match step {
        Progress::Tool(tool) => format!("Usando {tool}"),
        Progress::Note(note) => note.clone(),
    }
}

impl LlmBotService {
    /// The run of an answer about to be queued; `None` when nobody of the app answers there (a
    /// contact writing in an inbox without an AI agent schedules nothing worth showing).
    pub(super) fn describe(&self, target: Target) -> Result<Option<AgentRun>> {
        let repo = &self.helpdesk.core.repo;
        let id = run_id(target);
        match target {
            Target::Conversation(conversation_id) => {
                let Some(conversation) = repo.conversation_by_id(conversation_id)? else {
                    return Ok(None);
                };
                let agent = match self.system_target(&conversation)? {
                    Some((agent, _)) => Some((Some(agent.id), agent.name)),
                    None => {
                        let inbox = self.helpdesk.core.inbox(conversation.inbox_id)?;
                        match self.responder(&inbox)? {
                            Some(r) if self.can_answer(&conversation, &r) => Some(self.responder_name(&r)?),
                            _ => None,
                        }
                    }
                };
                let Some((agent_id, agent_name)) = agent else {
                    return Ok(None);
                };
                let who = conversation
                    .contact_name
                    .as_deref()
                    .unwrap_or(&conversation.contact_jid);
                let mut run = AgentRun::new(
                    id,
                    RUN_CONVERSATION,
                    format!("Conversa #{} · {who}", conversation.display_id),
                );
                run.agent_id = agent_id;
                run.agent_name = Some(agent_name);
                run.inbox_id = Some(conversation.inbox_id);
                run.inbox_name = Some(conversation.inbox_name);
                run.display_id = Some(conversation.display_id);
                Ok(Some(run))
            }
            Target::Chat(chat_id) => {
                let Some(chat) = repo.agent_chat_by_id(chat_id)? else {
                    return Ok(None);
                };
                let person = repo.user(chat.user_id)?.map_or_else(|| "a equipe".into(), |u| u.name);
                let mut run = AgentRun::new(id, RUN_CHAT, format!("Chat com {person}"));
                run.agent_id = Some(chat.agent_id);
                run.agent_name = repo.agent(chat.agent_id)?.map(|a| a.name);
                run.owner_id = Some(chat.user_id);
                Ok(Some(run))
            }
        }
    }

    fn responder_name(&self, responder: &super::Responder) -> Result<(Option<i64>, String)> {
        let repo = &self.helpdesk.core.repo;
        if let Some(id) = responder.agent_id {
            let name = repo.agent(id)?.map_or_else(|| format!("Agente {id}"), |a| a.name);
            return Ok((Some(id), name));
        }
        let bot = match responder.agent_bot_id {
            Some(id) => repo.agent_bot(id)?.map(|b| b.name),
            None => None,
        };
        Ok((None, bot.unwrap_or_else(|| "Robô de IA".into())))
    }

    /// Registers an answer just scheduled (ignoring a failure to describe it: the answer still runs).
    pub(super) fn track(&self, target: Target) {
        match self.describe(target) {
            Ok(Some(run)) => self.helpdesk.core.runs.queue(run),
            Ok(None) => {}
            Err(error) => tracing::debug!(%error, ?target, "execução não registrada"),
        }
    }
}
