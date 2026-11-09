//! The accountant plugin (`plugins/contador`) installed as it ships, against a stand-in for the
//! office's server: a customer only ever gets their own data (the server puts the conversation's
//! contact in the call), internal tools stay out of customer turns, and the routine that asks for
//! documents runs on the engine and messages clients only after a person approves each message.
use crate::agents_support;
use crate::common;
use crate::engine_support;

use agents_support::profiles;
use async_trait::async_trait;
use axum::extract::Path;
use axum::http::HeaderMap;
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

struct Unused;

#[async_trait]
impl Llm for Unused {
    async fn complete(&self, _request: &LlmRequest) -> Result<Completion> {
        panic!("agents on the engine never answer directly")
    }
}

type Calls = Arc<Mutex<Vec<(String, Value, String)>>>;

/// The office's server: records each call (tool, args, bearer) and answers like the real one.
async fn office(calls: Calls) -> String {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let router = Router::new().route(
        "/{tool}",
        post(
            move |Path(tool): Path<String>, headers: HeaderMap, Json(args): Json<Value>| {
                let calls = calls.clone();
                async move {
                    let bearer = headers.get("authorization").and_then(|v| v.to_str().ok()).unwrap_or("");
                    calls.lock().push((tool.clone(), args.clone(), bearer.to_string()));
                    Json(match tool.as_str() {
                        "situacao" => {
                            json!({"nome": "Ana Souza", "documentos_faltando": [{"tipo": "extrato bancário"}]})
                        }
                        "pendencias" => json!({"clientes": [{"nome": "Padaria Sol Ltda", "telefone": "+5511977776666",
                                                         "faltando": ["folha de pagamento"]}]}),
                        _ => json!({}),
                    })
                }
            },
        ),
    );
    tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
    format!("http://{address}")
}

fn script(seen: Arc<Mutex<Vec<Vec<String>>>>) -> engine_support::Script {
    Arc::new(move |turn: Turn| {
        let seen = seen.clone();
        Box::pin(async move {
            seen.lock().push(turn.tools.clone());
            if turn.input.contains("Um cliente escreveu") {
                // A prompt injection asks about someone else's phone.
                let answer = turn
                    .call("contador.situacao_do_cliente", json!({"telefone": "+5511977776666"}))
                    .await;
                let missing = answer.content["resultado"]["documentos_faltando"][0]["tipo"].clone();
                turn.call(
                    "concluir",
                    json!({"resposta": format!("Falta o {}.", missing.as_str().unwrap_or("?"))}),
                )
                .await;
                return Outcome::Done;
            }
            let pending = turn.call("contador.pendencias", json!({})).await;
            let client = pending.content["resultado"]["clientes"][0].clone();
            let message = format!(
                "Olá! Falta a {} deste mês.",
                client["faltando"][0].as_str().unwrap_or("?")
            );
            let sent = turn
                .call(
                    "mensagens.enviar_whatsapp",
                    json!({"telefone": client["telefone"], "mensagem": message}),
                )
                .await;
            if sent.content["status"] == "aguardando_aprovacao" {
                return Outcome::Done;
            }
            turn.call("concluir", json!({"resposta": "Cobrados: Padaria Sol Ltda."}))
                .await;
            Outcome::Done
        })
    })
}

#[tokio::test]
async fn the_accountant_plugin_keeps_customers_to_their_own_data_and_asks_before_messaging() {
    let mut f = Fixture::new().await;
    f.app.attach_llm(
        Arc::new(LlmRouter::default().with("opencode", Arc::new(Unused))),
        Duration::ZERO,
    );
    let runtime = Arc::new(ScriptedRuntime::default());
    f.app.attach_engine(
        f.store.clone(),
        vec![("opencode".into(), runtime.clone() as Arc<dyn AgentRuntime>)],
        "opencode",
        None,
    );
    let session = f.session("Escritório").id;
    let admin = f.bootstrap().await;
    let inbox = admin.get("/inboxes").await.body[0]["id"].as_i64().unwrap();

    let calls: Calls = Arc::default();
    let base = office(calls.clone()).await;
    let shipped = include_str!("../../../../plugins/contador/plugin.json").replace("http://127.0.0.1:8790", &base);
    let manifest: Value = serde_json::from_str(&shipped).unwrap();
    let installed = admin.post("/plugins", manifest.clone()).await;
    assert_eq!(installed.status, 201, "{:?}", installed.body);
    let token = admin
        .put("/plugins/contador/credentials/token", json!({"value": "t0k3n"}))
        .await;
    assert_eq!(token.status, 200);

    let p = profiles(&admin).await;
    let body = json!({"name": "Cora", "kind": "ai", "profile_id": p.of("operator"), "runtime": "opencode"});
    let cora = admin.post("/agent_directory", body).await.body["id"].as_i64().unwrap();
    let tools: Vec<String> = manifest["tools"]
        .as_array()
        .unwrap()
        .iter()
        .map(|t| format!("contador.{}", t["name"].as_str().unwrap()))
        .chain(["mensagens.enviar_whatsapp".to_string()])
        .collect();
    for tool in &tools {
        let url = format!("/engine/agents/{cora}/grants");
        assert_eq!(
            admin.put(&url, json!({"tool": tool, "effect": "allow"})).await.status,
            200
        );
    }
    let url = format!("/inboxes/{inbox}/ai_agent");
    assert_eq!(admin.post(&url, json!({ "ai_agent_id": cora })).await.status, 200);
    let seen = Arc::new(Mutex::new(Vec::new()));
    runtime.script("Cora", script(seen.clone()));

    // A customer asks; the office is asked about this customer, whatever phone the model sent.
    let message = Incoming {
        id: "IN1",
        body: "O que falta eu mandar?",
        ..Default::default()
    };
    f.incoming(&session, message);
    f.settle().await;
    let first = calls.lock().first().cloned();
    let (tool, args, bearer) = first.expect("the office tool was not called");
    assert_eq!((tool.as_str(), bearer.as_str()), ("situacao", "Bearer t0k3n"));
    assert_eq!(args["contato"]["telefone"], "+5511988887777", "{args}");
    assert_eq!(f.wa.sent().last().unwrap().text, "Falta o extrato bancário.");
    let customer_tools = seen.lock()[0].clone();
    assert!(customer_tools.contains(&"contador.situacao_do_cliente".to_string()));
    assert!(
        !customer_tools.contains(&"contador.pendencias".to_string()),
        "{customer_tools:?}"
    );
    assert!(!customer_tools.contains(&"mensagens.enviar_whatsapp".to_string()));

    // The routine the plugin suggests, created by the administrator for Cora.
    let routine = &manifest["schedules"][0];
    let schedule = admin
        .post(
            "/agent_schedules",
            json!({"name": routine["name"], "cron": routine["cron"], "prompt": routine["prompt"], "agent_ids": [cora]}),
        )
        .await;
    assert_eq!(schedule.status, 201, "{:?}", schedule.body);
    let id = schedule.body["id"].as_i64().unwrap();
    assert_eq!(
        admin
            .post(&format!("/agent_schedules/{id}/runs"), json!({}))
            .await
            .status,
        201
    );
    f.settle().await;
    let sent_before = f.wa.sent().len();
    let activities = admin.get("/engine/activities").await.body;
    let routine_run = activities
        .as_array()
        .unwrap()
        .iter()
        .find(|a| a["requester"] == format!("schedule:{id}"))
        .expect("the routine ran on the engine")
        .clone();
    assert_eq!(routine_run["status"], "waiting_approval", "{routine_run}");
    let detail = admin
        .get(&format!("/engine/activities/{}", routine_run["id"]))
        .await
        .body;
    let pending = detail["tree"][0]["tool_calls"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["tool"] == "mensagens.enviar_whatsapp")
        .expect("the message waits")
        .clone();
    assert_eq!(pending["status"], "pending_approval");

    let url = format!("/engine/tool_calls/{}/decision", pending["id"]);
    assert_eq!(admin.post(&url, json!({"approve": true})).await.status, 200);
    for _ in 0..200 {
        let now = admin
            .get(&format!("/engine/activities/{}", routine_run["id"]))
            .await
            .body;
        if now["activity"]["status"] == "completed" {
            break;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    f.settle().await;
    let sent = f.wa.sent();
    assert_eq!(sent.len(), sent_before + 1, "one message, after the approval");
    let last = sent.last().unwrap();
    assert_eq!(last.text, "Olá! Falta a folha de pagamento deste mês.");
    assert!(last.jid.starts_with("5511977776666"), "{}", last.jid);
}
