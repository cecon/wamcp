//! Quando o agente de IA de uma caixa responde: ele trabalha como qualquer atendente. A conversa
//! fica aberta e atribuída a ele (`assignee_agent_id`) até uma pessoa assumir; com um humano como
//! responsável ela não é mais dele. Um robô legado (`llm`, sem agente de IA) só atende as pendentes.
use super::{LlmBotService, Responder};
use crate::domain::model::Conversation;

impl LlmBotService {
    /// Whether the inbox's AI agent may answer this conversation.
    pub(super) fn can_answer(&self, conversation: &Conversation, responder: &Responder) -> bool {
        let Some(agent_id) = responder.agent_id else {
            return conversation.status == "pending";
        };
        owned_by_agent(
            &conversation.status,
            conversation.assignee_id,
            conversation.assignee_agent_id,
            agent_id,
        )
    }
}

/// The agent owns an open (or legacy pending) conversation it is assigned to and no person took.
/// No assignee at all only happens in data from before the agent became the assignee.
fn owned_by_agent(status: &str, assignee_id: Option<i64>, assignee_agent_id: Option<i64>, agent_id: i64) -> bool {
    matches!(status, "open" | "pending") && assignee_id.is_none() && assignee_agent_id.is_none_or(|id| id == agent_id)
}

#[cfg(test)]
mod tests {
    use super::owned_by_agent;

    #[test]
    fn the_agent_answers_open_conversations_assigned_to_it_until_a_person_takes_them() {
        assert!(owned_by_agent("open", None, Some(7), 7));
        assert!(owned_by_agent("pending", None, Some(7), 7));
        assert!(owned_by_agent("open", None, None, 7));
        assert!(!owned_by_agent("open", Some(1), None, 7));
        assert!(!owned_by_agent("open", None, Some(8), 7));
        assert!(!owned_by_agent("resolved", None, Some(7), 7));
        assert!(!owned_by_agent("snoozed", None, Some(7), 7));
    }
}
