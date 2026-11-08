//! Quando o agente de IA de uma caixa continua respondendo: pendente, ou aberta e órfã **depois** que
//! ele mesmo já falou nela (handoff sem humano assumir). Uma conversa aberta por pessoas não é dele.
use super::{LlmBotService, Responder};
use crate::domain::model::{Conversation, Message};

impl LlmBotService {
    /// Whether the inbox's AI agent may answer this conversation.
    pub(super) fn can_answer(&self, conversation: &Conversation, responder: &Responder) -> bool {
        if conversation.status == "pending" {
            return true;
        }
        if conversation.status != "open" || conversation.assignee_id.is_some() {
            return false;
        }
        // Só o agente de IA do roster continua depois do handoff enquanto ninguém assumir;
        // um bot `llm`/webhook da caixa para de responder quando entrega para humanos.
        responder.agent_id.is_some() && self.bot_spoke_last(conversation.id)
    }

    /// The last outgoing message (ignoring private/activity) came from an inbox bot/agent: the agent\n    /// was handling this conversation before the new incoming message arrived.
    fn bot_spoke_last(&self, conversation_id: i64) -> bool {
        let Ok(messages) = self.helpdesk.core.repo.messages(conversation_id, None, 20) else {
            return false;
        };
        last_spoken(&messages)
    }
}

fn last_spoken(messages: &[Message]) -> bool {
    messages
        .iter()
        .rev()
        .find(|m| !m.private && m.message_type == "outgoing")
        .is_some_and(|m| m.sender_type.as_deref() == Some("agent_bot"))
}

#[cfg(test)]
mod tests {
    use super::last_spoken;
    use crate::domain::model::Message;
    use serde_json::json;

    fn message(id: i64, message_type: &str, sender: Option<&str>) -> Message {
        Message {
            id,
            account_id: 1,
            conversation_id: 1,
            inbox_id: 1,
            message_type: message_type.into(),
            content: Some("x".into()),
            content_type: "text".into(),
            private: false,
            status: "sent".into(),
            sender_type: sender.map(String::from),
            sender_id: None,
            source_id: None,
            wa_jid: None,
            content_attributes: json!({}),
            created_at: id,
            sender_name: None,
            attachments: Vec::new(),
        }
    }

    #[test]
    fn only_a_bot_message_keeps_the_agent_in_an_open_conversation() {
        let from_person = [
            message(1, "incoming", Some("contact")),
            message(2, "outgoing", Some("user")),
        ];
        assert!(!last_spoken(&from_person));
        let from_bot = [
            message(1, "incoming", Some("contact")),
            message(2, "outgoing", Some("agent_bot")),
        ];
        assert!(last_spoken(&from_bot));
        let activity_only = [
            message(1, "outgoing", Some("agent_bot")),
            message(2, "activity", Some("system")),
        ];
        assert!(last_spoken(&activity_only));
    }
}
