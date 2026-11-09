//! The history on an AI agent's page: the conversations it answered, the ones it handed to a person
//! (with who took it and why) and only for AI agents.
use crate::agents_support;
use crate::common;

use agents_support::{ai, profiles};
use async_trait::async_trait;
use common::{Fixture, Incoming};
use serde_json::json;
use std::sync::Arc;
use std::time::Duration;
use wamcp_server::adapters::outbound::llm::LlmRouter;
use wamcp_server::application::ports::{Completion, Llm, LlmRequest, TokenUsage};
use wamcp_server::domain::error::Result;
use wamcp_server::domain::model::parse_handoff;

/// Answers "Oi", and hands off when the customer asks for a person.
struct Desk;

#[async_trait]
impl Llm for Desk {
    async fn complete(&self, request: &LlmRequest) -> Result<Completion> {
        let wants_person = format!("{request:?}").contains("falar com uma pessoa");
        Ok(Completion {
            answer: json!({ "reply": "Oi!", "handoff": wants_person }),
            usage: TokenUsage {
                input_tokens: 100,
                cached_input_tokens: 0,
                output_tokens: 10,
                cost_usd: Some(0.001),
            },
        })
    }
}

#[tokio::test]
async fn the_page_lists_what_the_agent_answered_and_why_it_handed_off() {
    let mut f = Fixture::new().await;
    let router = LlmRouter::default().with("claude_cli", Arc::new(Desk));
    f.app.attach_llm(Arc::new(router), Duration::ZERO);
    let session = f.session("Loja").id;
    let admin = f.bootstrap().await;
    let p = profiles(&admin).await;
    let inbox = admin.get("/inboxes").await.body[0]["id"].as_i64().unwrap();
    let lu = admin.post("/agent_directory", ai(&p, "Lu", "operator")).await.body["id"]
        .as_i64()
        .unwrap();
    let url = format!("/inboxes/{inbox}/ai_agent");
    assert_eq!(admin.post(&url, json!({ "ai_agent_id": lu })).await.status, 200);

    let empty = admin.get(&format!("/agent_directory/{lu}/history")).await;
    assert_eq!(empty.status, 200, "{:?}", empty.body);
    assert_eq!(empty.body["days"], 30);
    assert_eq!(empty.body["conversations"], json!([]));
    assert_eq!(empty.body["schedule_runs"], json!([]));

    for (id, body) in [("IN1", "Oi"), ("IN2", "Quero falar com uma pessoa")] {
        let message = Incoming {
            id,
            body,
            ..Default::default()
        };
        f.incoming(&session, message);
        f.settle().await;
    }

    let history = admin.get(&format!("/agent_directory/{lu}/history?days=7")).await.body;
    assert_eq!(history["days"], 7);
    let list = history["conversations"].as_array().unwrap();
    assert_eq!(list.len(), 1, "{history:?}");
    let conversation = &list[0];
    assert_eq!(conversation["turns"], 2);
    assert_eq!(conversation["handoff_reason"], "a IA não conseguiu resolver");
    assert!(conversation["handed_to"].is_string(), "{conversation:?}");
    assert!(conversation["handoff_at"].is_i64());
    assert!(conversation.get("handoff_note").is_none());

    let joao = json!({ "name": "João", "kind": "human", "profile_id": p.builtin, "whatsapp": "5511999990000" });
    let joao = admin.post("/agent_directory", joao).await.body["id"].as_i64().unwrap();
    assert_eq!(admin.get(&format!("/agent_directory/{joao}/history")).await.status, 400);
    assert_eq!(admin.get("/agent_directory/9999/history").await.status, 404);
}

#[test]
fn handoff_notes_split_into_person_and_reason() {
    let note = "Assistente IA passou a conversa para Ana Paula (a IA não respondeu depois de 3 tentativas)";
    assert_eq!(
        parse_handoff(note),
        Some((
            "Ana Paula".into(),
            Some("a IA não respondeu depois de 3 tentativas".into())
        ))
    );
    assert_eq!(
        parse_handoff("Assistente IA passou a conversa para Ana"),
        Some(("Ana".into(), None))
    );
    assert_eq!(parse_handoff("Ana entrou na conversa"), None);
}
