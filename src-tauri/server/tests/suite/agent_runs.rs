//! "Em execução": while an AI agent answers a conversation, the run is listed with the agent, the
//! conversation and the runtime's last step, to administrators and to the inbox's agents only; it
//! leaves the list when the answer is out.
use crate::agents_support;
use crate::common;

use agents_support::{ai, profiles};
use async_trait::async_trait;
use common::{Fixture, Incoming};
use serde_json::{json, Value};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Semaphore;
use wamcp_server::application::ports::{Completion, Llm, LlmRequest, Progress, ProgressSink};
use wamcp_server::domain::error::Result;

/// Tells one step, then holds the answer until the test lets it go.
struct HeldRuntime {
    gate: Semaphore,
}

#[async_trait]
impl Llm for HeldRuntime {
    async fn complete(&self, request: &LlmRequest) -> Result<Completion> {
        self.complete_live(request, &|_| {}).await
    }

    async fn complete_live(&self, _: &LlmRequest, progress: ProgressSink<'_>) -> Result<Completion> {
        progress(Progress::Tool("list_agents".into()));
        drop(self.gate.acquire().await);
        Ok(json!({ "reply": "Já vejo isso.", "handoff": false }).into())
    }

    fn location(&self) -> Option<String> {
        Some("C:/bin/claude.exe".into())
    }
}

async fn runs(agent: &common::Agent) -> Vec<Value> {
    agent
        .get("/agent_runs")
        .await
        .body
        .as_array()
        .cloned()
        .unwrap_or_default()
}

#[tokio::test]
async fn a_running_answer_is_listed_with_its_agent_and_step_until_it_ends() {
    let mut f = Fixture::new().await;
    let held = Arc::new(HeldRuntime {
        gate: Semaphore::new(0),
    });
    f.app.attach_llm(held.clone(), Duration::ZERO);
    let session = f.session("Padaria").id;
    let admin = f.bootstrap().await;
    let inbox = admin.get("/inboxes").await.body[0]["id"].as_i64().unwrap();
    let p = profiles(&admin).await;
    let created = admin.post("/agent_directory", ai(&p, "Ana", "operator")).await;
    let ana = created.body["id"].as_i64().unwrap();
    let url = format!("/inboxes/{inbox}/ai_agent");
    assert_eq!(admin.post(&url, json!({ "ai_agent_id": ana })).await.status, 200);
    let member = f.agent(&admin, "maria@example.com", "agent", true).await;
    let outsider = f.agent(&admin, "fora@example.com", "agent", false).await;

    let message = Incoming {
        id: "IN1",
        body: "Meu pedido chegou?",
        ..Default::default()
    };
    f.incoming(&session, message);
    let mut listed = Vec::new();
    for _ in 0..200 {
        listed = runs(&admin).await;
        if listed.first().is_some_and(|r| r["detail"] == "Usando list_agents") {
            break;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    assert_eq!(listed.len(), 1, "{listed:?}");
    let run = &listed[0];
    assert_eq!(run["kind"], "conversation");
    assert_eq!(run["state"], "running");
    assert_eq!(run["agent_id"], ana);
    assert_eq!(run["agent_name"], "Ana");
    assert_eq!(run["display_id"], 1);
    assert_eq!(run["inbox_id"], inbox);
    assert!(run["title"].as_str().unwrap().starts_with("Conversa #1"), "{run:?}");
    assert!(run["started_at"].as_i64().is_some());
    assert_eq!(runs(&member).await.len(), 1, "the inbox's agents follow it too");
    assert!(runs(&outsider).await.is_empty(), "agents of other inboxes do not");

    held.gate.add_permits(1);
    f.settle().await;
    assert!(runs(&admin).await.is_empty());
    assert_eq!(f.wa.sent().last().unwrap().text, "Já vejo isso.");
}
