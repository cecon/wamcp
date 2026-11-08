//! The bridge from conversations to the engine: when a customer writes to an inbox whose AI agent
//! runs on an engine runtime, the agent answers through the engine with its plugins' tools (never
//! the internal-only ones) and its `concluir` answer reaches the customer on WhatsApp.
use crate::agents_support;
use crate::common;
use crate::engine_support;

use agents_support::profiles;
use async_trait::async_trait;
use axum::routing::post;
use axum::{Json, Router};
use common::{Fixture, Incoming};
use engine_support::{Outcome, ScriptedRuntime, Turn};
use parking_lot::Mutex;
use serde_json::{json, Value};
use std::sync::Arc;
use std::time::Duration;
use wamcp_server::adapters::outbound::llm::LlmRouter;
use wamcp_server::application::ports::{AgentRuntime, Completion, Llm, LlmRequest};
use wamcp_server::domain::error::Result;

/// The direct path: must stay unused for an agent that runs on the engine.
#[derive(Default)]
struct Direct {
    calls: Mutex<usize>,
}

#[async_trait]
impl Llm for Direct {
    async fn complete(&self, _request: &LlmRequest) -> Result<Completion> {
        *self.calls.lock() += 1;
        Ok(json!({ "reply": "resposta direta", "handoff": false }).into())
    }
}

async fn deadlines() -> String {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let router = Router::new().route(
        "/prazos",
        post(|Json(args): Json<Value>| async move {
            Json(json!({ "cliente": args["cliente"], "prazo": "DAS vence no dia 20" }))
        }),
    );
    tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
    format!("http://{address}/prazos")
}

#[derive(Default)]
struct Seen {
    input: String,
    tools: Vec<String>,
    tool_answer: Value,
}

#[tokio::test]
async fn customers_get_answers_made_with_the_agents_plugin_tools() {
    let mut f = Fixture::new().await;
    let direct = Arc::new(Direct::default());
    f.app.attach_llm(
        Arc::new(LlmRouter::default().with("opencode", direct.clone())),
        Duration::ZERO,
    );
    let runtime = Arc::new(ScriptedRuntime::default());
    f.app.attach_engine(
        f.store.clone(),
        vec![("opencode".into(), runtime.clone() as Arc<dyn AgentRuntime>)],
        "opencode",
        None,
    );
    let session = f.session("Contabilidade").id;
    let admin = f.bootstrap().await;
    let inbox = admin.get("/inboxes").await.body[0]["id"].as_i64().unwrap();

    let url = deadlines().await;
    let manifest = json!({
        "id": "contador", "name": "Contador", "version": "1.0.0",
        "tools": [
            {"name": "prazos", "description": "Prazos fiscais do cliente",
             "endpoint": {"kind": "http", "url": url}},
            {"name": "enviar_lembrete", "description": "Lembra todos os clientes", "internal_only": true,
             "endpoint": {"kind": "http", "url": url}}
        ]
    });
    assert_eq!(admin.post("/plugins", manifest).await.status, 201);
    let p = profiles(&admin).await;
    let body = json!({ "name": "Cora", "kind": "ai", "profile_id": p.of("operator"), "runtime": "opencode",
                       "instructions": "Você é a assistente do escritório de contabilidade." });
    let cora = admin.post("/agent_directory", body).await.body["id"].as_i64().unwrap();
    for tool in ["contador.prazos", "contador.enviar_lembrete"] {
        let grant = admin
            .put(
                &format!("/engine/agents/{cora}/grants"),
                json!({"tool": tool, "effect": "allow"}),
            )
            .await;
        assert_eq!(grant.status, 200, "{:?}", grant.body);
    }
    let connected = admin
        .post(&format!("/inboxes/{inbox}/ai_agent"), json!({ "ai_agent_id": cora }))
        .await;
    assert_eq!(connected.status, 200, "{:?}", connected.body);

    let seen = Arc::new(Mutex::new(Seen::default()));
    let record = seen.clone();
    runtime.script(
        "Cora",
        Arc::new(move |turn: Turn| {
            let record = record.clone();
            Box::pin(async move {
                let answer = turn.call("contador.prazos", json!({"cliente": "Ana"})).await;
                {
                    let mut seen = record.lock();
                    seen.input = turn.input.clone();
                    seen.tools = turn.tools.clone();
                    seen.tool_answer = answer.content.clone();
                }
                let reply = format!(
                    "Oi! O {}.",
                    answer.content["resultado"]["prazo"].as_str().unwrap_or("?")
                );
                turn.call("concluir", json!({ "resposta": reply })).await;
                Outcome::Done
            })
        }),
    );

    let message = Incoming {
        id: "IN1",
        body: "Qual é o meu prazo?",
        ..Default::default()
    };
    f.incoming(&session, message);
    f.settle().await;

    let seen = seen.lock();
    assert!(seen.input.contains("Cliente: Qual é o meu prazo?"), "{}", seen.input);
    assert!(seen.tools.contains(&"contador.prazos".to_string()), "{:?}", seen.tools);
    assert!(
        !seen.tools.contains(&"contador.enviar_lembrete".to_string()),
        "internal-only tools stay out of a customer's turn"
    );
    assert_eq!(
        seen.tool_answer["resultado"]["prazo"], "DAS vence no dia 20",
        "{}",
        seen.tool_answer
    );
    assert_eq!(f.wa.sent().last().unwrap().text, "Oi! O DAS vence no dia 20.");
    assert_eq!(*direct.calls.lock(), 0, "the engine answered, not the direct path");
}
