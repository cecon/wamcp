//! A chat with an AI agent has sessions, like a chat app: the person ends one and starts another,
//! which the agent sees from scratch; the old ones stay readable, each shows what it spent, and a
//! session that reached its token limit takes no more messages.
mod agents_support;
mod common;

use agents_support::{ai, profiles};
use async_trait::async_trait;
use common::Fixture;
use parking_lot::Mutex;
use serde_json::{json, Value};
use std::sync::Arc;
use std::time::Duration;
use wamcp_server::adapters::outbound::llm::LlmRouter;
use wamcp_server::application::ports::{Completion, Llm, LlmRequest, TokenUsage};
use wamcp_server::domain::error::Result;
use wamcp_server::domain::model::{SESSION_FULL, SESSION_TOKEN_LIMIT};

/// Answers every message, spending a little over 60% of a session's tokens per call.
#[derive(Default)]
struct Hungry {
    prompts: Mutex<Vec<String>>,
}

#[async_trait]
impl Llm for Hungry {
    async fn complete(&self, request: &LlmRequest) -> Result<Completion> {
        self.prompts.lock().push(request.prompt.clone());
        let usage = TokenUsage {
            input_tokens: SESSION_TOKEN_LIMIT * 6 / 10,
            output_tokens: 50,
            cost_usd: Some(0.1),
            ..TokenUsage::default()
        };
        Ok(Completion {
            answer: json!({ "reply": "Certo." }),
            usage,
        })
    }

    fn location(&self) -> Option<String> {
        Some("C:/bin/claude.exe".into())
    }
}

#[tokio::test]
async fn a_new_session_starts_from_scratch_and_a_full_one_takes_no_more_messages() {
    let mut f = Fixture::new().await;
    let runtime = Arc::new(Hungry::default());
    f.app.attach_llm(
        Arc::new(LlmRouter::default().with("claude_cli", runtime.clone())),
        Duration::ZERO,
    );
    let admin = f.bootstrap().await;
    let p = profiles(&admin).await;
    let ana = admin.post("/agent_directory", ai(&p, "Ana", "operator")).await.body["id"]
        .as_i64()
        .unwrap();
    let say = |text: &'static str| {
        let admin = &admin;
        async move {
            admin
                .post(&format!("/agent_chats/{ana}/messages"), json!({ "content": text }))
                .await
        }
    };
    let sessions = || async { admin.get(&format!("/agent_chats/{ana}/sessions")).await.body };
    let texts = |list: Value| -> Vec<String> {
        list.as_array()
            .unwrap()
            .iter()
            .map(|m| m["content"].as_str().unwrap().to_string())
            .collect()
    };

    assert_eq!(say("Meu nome é Rui.").await.status, 201);
    f.settle().await;
    let first = sessions().await;
    assert_eq!(first["current"], 1);
    assert_eq!(first["token_limit"], SESSION_TOKEN_LIMIT);
    assert_eq!(first["sessions"][0]["tokens"], SESSION_TOKEN_LIMIT * 6 / 10 + 50);
    assert_eq!(first["sessions"][0]["preview"], "Meu nome é Rui.");
    assert!(first["sessions"][0]["cost_brl"].as_f64().unwrap() > 0.0);

    // A new session: the agent no longer sees the old messages, which stay readable.
    let started = admin.post(&format!("/agent_chats/{ana}/sessions"), json!({})).await;
    assert_eq!(started.status, 201, "{:?}", started.body);
    assert_eq!(started.body["current"], 2);
    let again = admin.post(&format!("/agent_chats/{ana}/sessions"), json!({})).await;
    assert_eq!(again.body["current"], 2, "an empty session is not ended");
    assert_eq!(again.body["sessions"].as_array().unwrap().len(), 2);
    assert!(texts(admin.get(&format!("/agent_chats/{ana}/messages")).await.body).is_empty());
    say("Qual o meu nome?").await;
    f.settle().await;
    let prompt = runtime.prompts.lock().last().unwrap().clone();
    assert!(
        prompt.contains("Qual o meu nome?") && !prompt.contains("Rui"),
        "{prompt}"
    );
    assert_eq!(
        texts(admin.get(&format!("/agent_chats/{ana}/messages?session=1")).await.body),
        ["Meu nome é Rui.", "Certo."]
    );
    let list = admin.get("/agent_chats").await.body;
    let card = list.as_array().unwrap().iter().find(|a| a["id"] == ana).unwrap();
    assert_eq!(
        (card["last"]["content"].clone(), card["last"]["session"].clone()),
        (json!("Certo."), json!(2))
    );

    // Past the limit the session refuses messages until the person starts another.
    say("Mais uma coisa.").await;
    f.settle().await;
    let full = sessions().await;
    assert_eq!(full["sessions"][0]["full"], true);
    let refused = say("E agora?").await;
    assert_eq!(refused.status, 400, "{:?}", refused.body);
    assert!(refused.body.to_string().contains(SESSION_FULL), "{:?}", refused.body);
    assert_eq!(runtime.prompts.lock().len(), 3);
    admin.post(&format!("/agent_chats/{ana}/sessions"), json!({})).await;
    assert_eq!(say("E agora?").await.status, 201);
}
