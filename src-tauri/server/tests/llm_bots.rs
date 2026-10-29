//! LLM bots: the server answers pending conversations with an LLM provider (a scripted fake here).
mod common;

use async_trait::async_trait;
use common::{Fixture, Incoming};
use parking_lot::Mutex;
use serde_json::{json, Value};
use std::sync::Arc;
use std::time::Duration;
use wamcp_server::adapters::outbound::llm::claude_cli::{arguments, parse_output};
use wamcp_server::adapters::outbound::llm::LlmRouter;
use wamcp_server::application::ports::{Completion, Llm, LlmRequest};
use wamcp_server::domain::error::Result;

/// Records every request and answers with the queued values (the last one repeats).
#[derive(Default)]
struct ScriptedLlm {
    calls: Mutex<Vec<LlmRequest>>,
    answers: Mutex<Vec<Value>>,
}

#[async_trait]
impl Llm for ScriptedLlm {
    async fn complete(&self, request: &LlmRequest) -> Result<Completion> {
        self.calls.lock().push(request.clone());
        let mut answers = self.answers.lock();
        Ok(if answers.len() > 1 {
            answers.remove(0)
        } else {
            answers[0].clone()
        }
        .into())
    }
}

/// A fixture whose first inbox is served by an LLM bot backed by `llm`.
async fn setup(answers: Vec<Value>, debounce: Duration) -> (Fixture, Arc<ScriptedLlm>, String, Value) {
    let mut f = Fixture::new().await;
    let llm = Arc::new(ScriptedLlm {
        answers: Mutex::new(answers),
        ..Default::default()
    });
    let router = LlmRouter::default().with("claude_cli", llm.clone());
    f.app.attach_llm(Arc::new(router), debounce);
    let session = f.session("Padaria").id;
    let admin = f.bootstrap().await;
    let created = admin
        .post(
            "/agent_bots",
            json!({ "name": "Atendente IA", "kind": "llm", "provider": "claude_cli", "model": "haiku",
                    "instructions": "Somos a Padaria Sol. Abrimos às 7h." }),
        )
        .await;
    assert_eq!(created.status, 201, "{:?}", created.body);
    let inbox = admin.get("/inboxes").await.body[0]["id"].as_i64().unwrap();
    let bot = created.body["agent_bot"].clone();
    admin
        .post(
            &format!("/inboxes/{inbox}/agent_bot"),
            json!({ "agent_bot_id": bot["id"] }),
        )
        .await;
    (f, llm, session, bot)
}

fn answer(reply: &str, handoff: bool) -> Value {
    json!({ "reply": reply, "handoff": handoff })
}

#[tokio::test]
async fn llm_bots_answer_pending_conversations_as_the_bot() {
    let (f, llm, session, bot) = setup(vec![answer("Bom dia! Abrimos às 7h.", false)], Duration::ZERO).await;
    assert_eq!(bot["kind"], "llm");
    assert_eq!(bot["outgoing_url"], "");
    let admin = f.bootstrap().await;
    assert_eq!(
        admin
            .post(&format!("/agent_bots/{}/reset_access_token", bot["id"]), json!({}))
            .await
            .status,
        400,
        "LLM bots have no API token"
    );

    let body = "Que horas vocês abrem?";
    f.incoming(
        &session,
        Incoming {
            body,
            ..Default::default()
        },
    );
    f.settle().await;
    let calls = llm.calls.lock().clone();
    assert_eq!(calls.len(), 1);
    assert_eq!(
        (calls[0].provider.as_str(), calls[0].model.as_deref()),
        ("claude_cli", Some("haiku"))
    );
    assert!(calls[0].prompt.contains("Somos a Padaria Sol."));
    assert!(calls[0].prompt.contains("Cliente: Que horas vocês abrem?"));
    assert_eq!(calls[0].schema["required"], json!(["reply", "handoff"]));
    assert_eq!(f.wa.sent().last().unwrap().text, "Bom dia! Abrimos às 7h.");
    let conversation = admin.get("/conversations/1").await.body;
    assert_eq!(conversation["status"], "pending", "still with the bot");
    let messages = admin.get("/conversations/1/messages").await.body;
    let last = messages["payload"]
        .as_array()
        .or(messages.as_array())
        .unwrap()
        .last()
        .unwrap()
        .clone();
    assert_eq!(last["sender_type"], "agent_bot");
    f.app.state.support().webhooks.deliver_due().await.unwrap();
    assert!(
        f.sender.posts.lock().is_empty(),
        "nothing is delivered to an LLM bot's webhook row"
    );

    let next = Incoming {
        id: "IN2",
        body: "Obrigado",
        ..Default::default()
    };
    f.incoming(&session, next);
    f.settle().await;
    assert_eq!(llm.calls.lock().len(), 2);
    assert!(llm.calls.lock()[1].prompt.contains("Você: Bom dia! Abrimos às 7h."));
}

#[tokio::test]
async fn handoff_opens_the_conversation_and_the_bot_stops() {
    let (f, llm, session, _) = setup(vec![answer("Vou transferir para a equipe.", true)], Duration::ZERO).await;
    f.incoming(
        &session,
        Incoming {
            body: "Quero falar com uma pessoa",
            ..Default::default()
        },
    );
    f.settle().await;
    let admin = f.bootstrap().await;
    assert_eq!(admin.get("/conversations/1").await.body["status"], "open");
    assert_eq!(f.wa.sent().last().unwrap().text, "Vou transferir para a equipe.");
    f.incoming(
        &session,
        Incoming {
            id: "IN2",
            body: "Alô?",
            ..Default::default()
        },
    );
    f.settle().await;
    assert_eq!(llm.calls.lock().len(), 1, "humans answer after the handoff");
}

#[tokio::test]
async fn a_burst_of_messages_gets_one_answer() {
    let (f, llm, session, _) = setup(vec![answer("Oi! Como posso ajudar?", false)], Duration::from_millis(80)).await;
    for (id, body) in [("IN1", "Oi"), ("IN2", "Tudo bem?"), ("IN3", "Preciso de ajuda")] {
        f.incoming(
            &session,
            Incoming {
                id,
                body,
                ..Default::default()
            },
        );
    }
    f.settle().await;
    assert_eq!(llm.calls.lock().len(), 1);
    assert!(llm.calls.lock()[0].prompt.contains("Cliente: Preciso de ajuda"));
    assert_eq!(f.wa.sent().len(), 1);
}

#[tokio::test]
async fn bots_validate_kind_and_provider() {
    let (f, _, _, bot) = setup(vec![answer("ok", false)], Duration::ZERO).await;
    let admin = f.bootstrap().await;
    let unknown = json!({ "name": "X", "kind": "llm", "provider": "openrouter" });
    assert_eq!(admin.post("/agent_bots", unknown).await.status, 400);
    assert_eq!(
        admin
            .post("/agent_bots", json!({ "name": "X", "kind": "magic" }))
            .await
            .status,
        400
    );
    let id = &bot["id"];
    let url = json!({ "outgoing_url": "https://bot.example.com/hook" });
    assert_eq!(admin.patch(&format!("/agent_bots/{id}"), url).await.status, 400);
    let edited = admin
        .patch(
            &format!("/agent_bots/{id}"),
            json!({ "instructions": "Novo texto", "model": null }),
        )
        .await;
    assert_eq!(
        (edited.body["instructions"].as_str(), edited.body["model"].as_null()),
        (Some("Novo texto"), Some(()))
    );
}

#[test]
fn claude_cli_runs_headless_without_tools_and_reads_the_structured_output() {
    let request = LlmRequest {
        provider: "claude_cli".into(),
        model: Some("haiku".into()),
        system: "Sistema".into(),
        prompt: "Cliente: segredo do contato".into(),
        schema: json!({ "type": "object" }),
        api_key: None,
    };
    let args = arguments(&request);
    let after = |flag: &str| args[args.iter().position(|a| a == flag).unwrap() + 1].clone();
    assert_eq!(after("--tools"), "");
    assert_eq!(after("--setting-sources"), "project,local");
    assert_eq!(after("--settings"), r#"{"disableAllHooks":true}"#);
    assert_eq!(after("--model"), "haiku");
    assert!(
        args.contains(&"--strict-mcp-config".to_string()) && args.contains(&"--no-session-persistence".to_string())
    );
    assert!(
        !args.iter().any(|a| a.contains("segredo")),
        "the prompt goes through stdin"
    );

    let ok = br#"{"type":"result","is_error":false,"structured_output":{"reply":"Oi","handoff":false}}"#;
    assert_eq!(
        parse_output(ok, b"").unwrap(),
        json!({ "reply": "Oi", "handoff": false })
    );
    let failed = br#"{"type":"result","is_error":true,"result":"Not logged in"}"#;
    assert!(parse_output(failed, b"")
        .unwrap_err()
        .to_string()
        .contains("Not logged in"));
    assert!(parse_output(b"", b"spawn failed")
        .unwrap_err()
        .to_string()
        .contains("spawn failed"));
}
