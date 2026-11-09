//! A customer's turn as an engine request: the agent gets the conversation (its summary and the
//! latest messages, newest kept first when it does not fit) and answers the customer with
//! `concluir`, which the engine posts in the conversation. A person's internal chat goes the same way.
use super::llm::transcript;
use super::model::Message;

/// The engine's limit for a request.
pub const REQUEST_LIMIT: usize = 4000;
const SUMMARY_LIMIT: usize = 1200;

pub fn conversation_request(inbox: &str, display_id: i64, summary: Option<&str>, messages: &[Message]) -> String {
    let mut head = format!(
        "Um cliente escreveu na conversa #{display_id} da caixa \"{inbox}\". Responda a ele com `concluir`: \
         a resposta vai direto para o cliente. Use as ferramentas das suas skills quando precisar de dados.\n\n"
    );
    if let Some(summary) = summary.map(str::trim).filter(|s| !s.is_empty()) {
        let short: String = summary.chars().take(SUMMARY_LIMIT).collect();
        head.push_str(&format!("Resumo do começo da conversa:\n{short}\n\n"));
    }
    fit(head, messages, "Cliente")
}

/// A person's turn in their internal chat with an agent as an engine request: the answer of
/// `concluir` goes back to the chat.
pub fn chat_request(person: &str, messages: &[Message]) -> String {
    let head = format!(
        "{person}, da equipe, escreveu no chat interno com você. Responda com `concluir`: a resposta volta para o \
         chat. Delegue a outros agentes quando o pedido for da área deles e use as ferramentas das suas skills.\n\n"
    );
    fit(head, messages, person)
}

/// The head plus the newest messages that fit in the engine's limit.
fn fit(head: String, messages: &[Message], speaker: &str) -> String {
    let room = REQUEST_LIMIT.saturating_sub(head.chars().count());
    // Drop the oldest messages until the transcript fits.
    let mut start = 0;
    let mut text = transcript(messages, speaker);
    while text.chars().count() > room && start + 1 < messages.len() {
        start += 1;
        text = transcript(&messages[start..], speaker);
    }
    let text: String = text
        .chars()
        .rev()
        .take(room)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect();
    head + &text
}

#[cfg(test)]
mod tests {
    use super::*;

    fn message(id: i64, content: &str) -> Message {
        serde_json::from_value(serde_json::json!({
            "id": id, "account_id": 1, "conversation_id": 1, "inbox_id": 1, "message_type": "incoming",
            "content": content, "content_type": "text", "private": false, "status": "sent",
            "content_attributes": {}, "created_at": 0
        }))
        .unwrap()
    }

    #[test]
    fn keeps_the_newest_messages_within_the_limit() {
        let messages: Vec<Message> = (0..200)
            .map(|n| message(n, &format!("mensagem {n} {}", "x".repeat(40))))
            .collect();
        let request = conversation_request("Contabilidade", 7, Some("Cliente Ana, MEI."), &messages);
        assert!(request.chars().count() <= REQUEST_LIMIT);
        assert!(request.starts_with("Um cliente escreveu na conversa #7"));
        assert!(request.contains("Cliente Ana, MEI."));
        assert!(request.contains("mensagem 199"));
        assert!(!request.contains("mensagem 0 "));
    }
}
