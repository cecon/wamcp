//! Handoff obrigatório da IA para um humano. A IA é a responsável pela conversa enquanto atende;
//! quando não consegue resolver, a conversa precisa sair das mãos dela para uma pessoa.
use super::helpdesk::HelpdeskService;
use crate::domain::actor::Actor;
use crate::domain::error::{fail_with, Result};
use crate::domain::model::{Conversation, ConversationChanges as Changes};

impl HelpdeskService {
    /// Garante que a IA da caixa apareça como responsável em conversas que ela atende (dados antigos).
    pub fn ensure_ai_responsible(&self, conversation: &Conversation) -> Result<Conversation> {
        if conversation.assignee_id.is_some() || conversation.assignee_agent_id.is_some() {
            return Ok(conversation.clone());
        }
        let Some(agent_id) = self.core.inbox(conversation.inbox_id)?.ai_agent_id else {
            return Ok(conversation.clone());
        };
        self.core.update(
            conversation.id,
            Changes {
                assignee_agent_id: Some(Some(agent_id)),
                ..Default::default()
            },
        )
    }

    /// Passa a conversa para um humano: membros online da caixa (e do time, quando o time permite),
    /// ou, na falta deles, um administrador ativo. Sem nenhum humano disponível, devolve 422 — a IA
    /// não pode simplesmente abandonar a conversa.
    pub fn handoff_to_human(&self, actor: &Actor, conversation: &Conversation, reason: &str) -> Result<Conversation> {
        let inbox = self.core.inbox(conversation.inbox_id)?;
        let team_scope = match conversation.team_id {
            Some(id) => self
                .core
                .repo
                .team(id)?
                .filter(|team| team.allow_auto_assign != 0)
                .map(|team| team.id),
            None => None,
        };
        let mut candidates = self.core.repo.assignable_ids(inbox.id, team_scope, None)?;
        if candidates.is_empty() {
            candidates = self
                .core
                .repo
                .users()?
                .into_iter()
                .filter(|user| user.is_active() && user.role == "administrator")
                .map(|user| user.id)
                .collect();
        }
        let Some(user_id) = candidates.first().copied() else {
            return fail_with("Nenhum humano disponível para assumir a conversa", 422);
        };
        let name = self.core.repo.user(user_id)?.map(|user| user.name).unwrap_or_default();
        self.core.commit(Some(actor), |events| {
            let updated = self.core.update(
                conversation.id,
                Changes {
                    assignee_id: Some(Some(user_id)),
                    assignee_agent_id: Some(None),
                    status: Some("open".into()),
                    ..Default::default()
                },
            )?;
            self.core.activity(
                &updated,
                format!("Assistente IA passou a conversa para {name} ({reason})"),
                events,
            )?;
            events.push("assignee.changed", &updated);
            Ok(updated)
        })
    }
}
