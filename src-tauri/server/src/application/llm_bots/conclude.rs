//! What the agent does with its answer: the reply goes out as the inbox bot, then the conversation
//! is handed to a person (handoff or forward) or resolved when its goal was reached.
use super::{LlmBotService, Responder};
use crate::domain::actor::Actor;
use crate::domain::error::Result;
use crate::domain::llm::Answer;
use crate::domain::model::{Conversation, Inbox};

impl LlmBotService {
    pub(super) async fn conclude(
        &self,
        inbox: &Inbox,
        conversation: &Conversation,
        responder: &Responder,
        answer: Answer,
        forwarded: bool,
    ) -> Result<()> {
        let core = &self.helpdesk.core;
        // A person may have taken the conversation while the model was thinking. When the agent
        // itself forwarded it to its supervisor during the run, its answer still goes out.
        let current = core.repo.conversation_by_id(conversation.id)?;
        if !forwarded && current.as_ref().is_none_or(|c| !self.can_answer(c, responder)) {
            return Ok(());
        }
        let actor = Actor::Bot { inbox_id: inbox.id };
        if !answer.reply.is_empty() {
            self.helpdesk
                .reply(&actor, conversation.display_id, &answer.reply, false)
                .await?;
        }
        if answer.handoff || forwarded {
            // Regra do produto: se a IA não resolve, a conversa obrigatoriamente vai para um humano
            // (o encaminhamento ao responsável direto já entregou para uma pessoa).
            let target = core
                .repo
                .conversation_by_id(conversation.id)?
                .unwrap_or_else(|| conversation.clone());
            if target.assignee_id.is_none() {
                self.helpdesk
                    .handoff_to_human(&actor, &target, "a IA não conseguiu resolver")?;
            }
        } else if answer.resolve {
            // O objetivo da conversa foi atingido: a IA encerra como qualquer atendente.
            self.helpdesk
                .toggle_status(&actor, conversation.display_id, "resolved", None)?;
        }
        Ok(())
    }
}
