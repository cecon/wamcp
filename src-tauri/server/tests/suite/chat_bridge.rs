//! The chain closes for people too: a person's internal chat with an agent that runs on the engine
//! becomes an engine request on their behalf and the answer comes back to the chat, and a request
//! made in "Motor de agentes" comes back to the person's chat with the agent when it ends.
use crate::agents_support;
use crate::common;
use crate::engine_support;

use agents_support::profiles;
use async_trait::async_trait;
use common::Fixture;
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
        Ok(json!({ "reply": "resposta direta" }).into())
    }
}

async fn agent_messages(admin: &common::Agent, agent: i64, count: usize) -> Vec<Value> {
    for _ in 0..250 {
        let list = admin.get(&format!("/agent_chats/{agent}/messages")).await.body;
        let list = list.as_array().cloned().unwrap_or_default();
        let answers: Vec<Value> = list.into_iter().filter(|m| m["role"] != "user").collect();
        if answers.len() >= count {
            return answers;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    panic!("the chat never got {count} answer(s)");
}

#[tokio::test]
async fn chats_and_requests_with_an_engine_agent_come_back_to_the_person() {
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
    let admin = f.bootstrap().await;
    let p = profiles(&admin).await;
    let body = json!({ "name": "Cora", "kind": "ai", "profile_id": p.of("operator"), "runtime": "opencode",
                       "instructions": "Você é a assistente do escritório." });
    let cora = admin.post("/agent_directory", body).await.body["id"].as_i64().unwrap();

    let inputs = Arc::new(Mutex::new(Vec::<String>::new()));
    let record = inputs.clone();
    runtime.script(
        "Cora",
        Arc::new(move |turn: Turn| {
            let record = record.clone();
            Box::pin(async move {
                record.lock().push(turn.input.clone());
                turn.call("concluir", json!({ "resposta": "O DAS vence no dia 20." }))
                    .await;
                Outcome::Done
            })
        }),
    );

    let sent = admin
        .post(
            &format!("/agent_chats/{cora}/messages"),
            json!({ "content": "Quando vence o DAS?" }),
        )
        .await;
    assert!(sent.status < 300, "{:?}", sent.body);
    let answers = agent_messages(&admin, cora, 1).await;
    assert_eq!(answers[0]["role"], "agent");
    assert_eq!(answers[0]["content"], "O DAS vence no dia 20.");
    assert!(inputs.lock()[0].contains("chat interno") && inputs.lock()[0].contains("Quando vence o DAS?"));
    assert_eq!(*direct.calls.lock(), 0, "the engine answered, not the direct path");

    // The request is on the engine, on behalf of the person, and its answer went to the chat.
    let activities = admin.get("/engine/activities").await.body;
    let id = activities[0]["id"].as_i64().unwrap();
    assert_eq!(activities[0]["requester"], format!("user:{}", admin.id()));
    let detail = admin.get(&format!("/engine/activities/{id}")).await.body;
    assert_eq!(detail["recipients"][0]["kind"], "chat");
    assert_eq!(detail["recipients"][0]["last_event"], "completed");
    assert!(detail["requester_name"].is_string(), "{detail}");

    // A request from "Motor de agentes" comes back to the person's chat with the agent.
    let asked = admin
        .post(
            "/engine/activities",
            json!({ "agent_id": cora, "request": "Feche o mês da Ana" }),
        )
        .await;
    assert_eq!(asked.status, 201, "{:?}", asked.body);
    let answers = agent_messages(&admin, cora, 2).await;
    let text = answers[1]["content"].as_str().unwrap();
    assert!(
        text.starts_with(&format!("Pedido #{} concluído por Cora.", asked.body["id"])),
        "{text}"
    );
    assert!(text.contains("Feche o mês da Ana") && text.contains("O DAS vence no dia 20."));

    let bad = json!({ "agent_id": cora, "request": "x", "copies": [{ "kind": "agent", "id": 1 }] });
    assert_eq!(admin.post("/engine/activities", bad).await.status, 400);
}
