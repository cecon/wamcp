//! Long conversations: the prompt shows the latest messages, and what came before them reaches
//! the agent as a summary, made by the agent's own model and refreshed as the conversation grows.
use super::llm::transcript;
use super::model::Message;
use serde_json::{json, Value};

/// When the summary is refreshed it covers everything but this many of the latest messages, so
/// the next refresh only happens after as many new ones.
pub const KEEP_RECENT: usize = 20;

/// The most messages one refresh reads (older ones of a very long first summary are left out).
pub const SUMMARY_BATCH: i64 = 200;

pub const SUMMARY_SYSTEM: &str = "Você resume conversas de atendimento para o próprio agente que atende. \
Escreva em português, em até 12 linhas, só fatos: quem é o cliente, o que pediu, o que já foi \
combinado, valores, prazos e o que ficou pendente. Não invente nada que não esteja na conversa.";

pub fn summary_schema() -> Value {
    json!({
        "type": "object",
        "properties": { "summary": { "type": "string" } },
        "required": ["summary"],
        "additionalProperties": false
    })
}

/// The previous summary (if any) and the messages it does not cover yet, oldest first.
pub fn summary_prompt(previous: Option<&str>, messages: &[Message]) -> String {
    let mut prompt = String::new();
    if let Some(previous) = previous.map(str::trim).filter(|p| !p.is_empty()) {
        prompt.push_str(&format!("Resumo até aqui:\n{previous}\n\n"));
    }
    prompt.push_str(&transcript(messages, "Cliente"));
    prompt.push_str("\nAtualize o resumo com estas mensagens.");
    prompt
}

pub fn parse_summary(answer: &Value) -> Option<String> {
    let summary = answer.get("summary")?.as_str()?.trim();
    (!summary.is_empty()).then(|| summary.chars().take(4000).collect())
}

/// How the summary enters the agent's prompt.
pub fn with_summary(summary: &str, prompt: &str) -> String {
    format!("Resumo do começo da conversa (mensagens antigas):\n{summary}\n\n{prompt}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_and_places_the_summary() {
        assert_eq!(
            parse_summary(&json!({"summary": " Pediu 2 pizzas. "})).as_deref(),
            Some("Pediu 2 pizzas.")
        );
        assert_eq!(parse_summary(&json!({"summary": "  "})), None);
        assert_eq!(parse_summary(&json!({"reply": "x"})), None);
        let prompt = summary_prompt(Some("Cliente Ana."), &[]);
        assert!(prompt.starts_with("Resumo até aqui:\nCliente Ana."));
        assert!(with_summary("S", "P").ends_with("S\n\nP"));
    }
}
