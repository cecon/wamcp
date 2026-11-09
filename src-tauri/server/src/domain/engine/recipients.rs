//! Who hears about a request when it ends or stops: the person who asked (in their chat with the
//! agent, or in the internal chat the request came from) and the copies they added (people of the app
//! or contacts on WhatsApp). A customer's conversation is answered by `concluir` itself.
use super::activity::{CANCELLED, COMPLETED, FAILED, WAITING_APPROVAL};
use serde::{Deserialize, Serialize};

/// A person of the app: the message goes to their chat with the agent that received the request.
pub const USER: &str = "user";
/// A WhatsApp contact.
pub const CONTACT: &str = "contact";
/// The internal chat the request came from (the answer goes back there, as the agent's reply).
pub const CHAT: &str = "chat";
pub const KINDS: [&str; 3] = [USER, CONTACT, CHAT];

/// The most copies one request takes.
pub const MAX_COPIES: usize = 10;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Recipient {
    pub id: i64,
    pub activity_id: i64,
    pub kind: String,
    pub target_id: i64,
    /// Added by the requester as a copy (not the requester themselves).
    pub copy: bool,
    /// The last state they were told about (`completed`, `failed`, `cancelled`, `waiting_approval`).
    pub last_event: Option<String>,
    pub notified: Option<String>,
    pub error: Option<String>,
    /// Who it is, for the request's screen (filled when listing).
    #[serde(default)]
    pub name: Option<String>,
}

/// One message to deliver.
#[derive(Debug, Clone, PartialEq)]
pub struct Delivery {
    pub kind: String,
    pub target_id: i64,
    /// The agent that received the request (the chat of a person is with this agent).
    pub agent_id: i64,
    /// The chat role: `agent`, or `error` when the request failed.
    pub failed: bool,
    pub text: String,
}

/// The states worth telling someone about.
pub fn notifies(status: &str) -> bool {
    matches!(status, COMPLETED | FAILED | CANCELLED | WAITING_APPROVAL)
}

/// The requester as a recipient: `user:<id>` hears in their chat with the agent; contacts are
/// answered in their conversation and agents (delegations) by the engine itself.
pub fn requester_recipient(requester: &str) -> Option<(&'static str, i64)> {
    let id = requester.strip_prefix("user:")?.parse().ok()?;
    Some((USER, id))
}

pub struct Outcome<'a> {
    pub activity_id: i64,
    pub agent: &'a str,
    pub request: &'a str,
    pub status: &'a str,
    pub result: Option<&'a str>,
    pub error: Option<&'a str>,
}

fn short(text: &str, limit: usize) -> String {
    let text = text.trim();
    if text.chars().count() <= limit {
        return text.to_string();
    }
    let cut: String = text.chars().take(limit).collect();
    format!("{}…", cut.trim_end())
}

/// What a recipient reads. The chat a request came from gets the answer as the agent's own reply;
/// everyone else gets the request number, what was asked and the outcome.
pub fn message(kind: &str, copy: bool, o: &Outcome) -> String {
    let id = o.activity_id;
    let body = match o.status {
        COMPLETED => o.result.unwrap_or_default().trim().to_string(),
        FAILED => format!("Não consegui concluir: {}", o.error.unwrap_or("erro sem detalhe")),
        CANCELLED => "O pedido foi cancelado antes de terminar.".to_string(),
        _ => format!(
            "Preciso da aprovação de uma pessoa para seguir. Ela decide no pedido #{id}, em Motor de agentes; \
             aviso aqui quando terminar."
        ),
    };
    if kind == CHAT {
        return body;
    }
    let head = match (o.status, copy) {
        (COMPLETED, false) => format!("Pedido #{id} concluído por {}.", o.agent),
        (COMPLETED, true) => format!("Cópia do pedido #{id}, concluído por {}.", o.agent),
        (FAILED, _) => format!("O pedido #{id} para {} falhou.", o.agent),
        (CANCELLED, _) => format!("O pedido #{id} para {} foi cancelado.", o.agent),
        _ => format!("O pedido #{id} para {} espera uma aprovação.", o.agent),
    };
    format!("{head}\nPedido: {}\n\n{body}", short(o.request, 280))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn outcome<'a>(status: &'a str, result: Option<&'a str>, error: Option<&'a str>) -> Outcome<'a> {
        Outcome {
            activity_id: 7,
            agent: "Ana",
            request: "Feche o caixa de ontem",
            status,
            result,
            error,
        }
    }

    #[test]
    fn the_requester_and_copies_read_the_request_and_the_outcome() {
        let done = message(USER, false, &outcome(COMPLETED, Some("Caixa fechado: R$ 1.200."), None));
        assert_eq!(
            done,
            "Pedido #7 concluído por Ana.\nPedido: Feche o caixa de ontem\n\nCaixa fechado: R$ 1.200."
        );
        let copy = message(CONTACT, true, &outcome(COMPLETED, Some("ok"), None));
        assert!(copy.starts_with("Cópia do pedido #7"));
        let failed = message(USER, false, &outcome(FAILED, None, Some("Tempo esgotado")));
        assert!(failed.contains("falhou") && failed.ends_with("Não consegui concluir: Tempo esgotado"));
        let waiting = message(USER, false, &outcome(WAITING_APPROVAL, None, None));
        assert!(waiting.contains("espera uma aprovação") && waiting.contains("pedido #7"));
    }

    #[test]
    fn the_chat_a_request_came_from_gets_the_plain_answer() {
        assert_eq!(
            message(CHAT, false, &outcome(COMPLETED, Some(" Feito. "), None)),
            "Feito."
        );
        assert_eq!(
            message(CHAT, false, &outcome(FAILED, None, Some("sem acesso"))),
            "Não consegui concluir: sem acesso"
        );
    }

    #[test]
    fn only_people_are_recipients_as_requesters() {
        assert_eq!(requester_recipient("user:3"), Some((USER, 3)));
        assert_eq!(requester_recipient("contact:3"), None);
        assert_eq!(requester_recipient("schedule:3"), None);
        assert!(notifies(WAITING_APPROVAL) && !notifies("running"));
        let long = "x".repeat(400);
        assert!(short(&long, 280).chars().count() == 281);
    }
}
