//! "Agentes ao vivo": a paused agent answers nothing until it is resumed, a conversation left
//! waiting (the app stopped mid-answer) is answered on recovery, an administrator stops an answer
//! and the conversation goes to people, and long conversations reach the agent with a summary.
use crate::agents_support;
use crate::common;

use agents_support::{ai, profiles};
use async_trait::async_trait;
use common::{Fixture, Incoming};
use parking_lot::Mutex;
use serde_json::{json, Value};
use std::sync::Arc;
use std::time::Duration;
use wamcp_server::adapters::outbound::llm::LlmRouter;
use wamcp_server::application::ports::{Completion, LiveRepo, Llm, LlmRequest};
use wamcp_server::domain::error::Result;

/// Answers every request (a summary request with a summary); `hang` holds the answers forever.
#[derive(Default)]
struct Runtime {
    calls: Mutex<Vec<LlmRequest>>,
    hang: Mutex<bool>,
}

#[async_trait]
impl Llm for Runtime {
    async fn complete(&self, request: &LlmRequest) -> Result<Completion> {
        self.calls.lock().push(request.clone());
        if *self.hang.lock() {
            std::future::pending::<()>().await;
        }
        if request.system.starts_with("Você resume") {
            return Ok(json!({ "summary": "Cliente Ana quer pães para a festa." }).into());
        }
        Ok(json!({ "reply": "Pode deixar!", "handoff": false }).into())
    }

    fn location(&self) -> Option<String> {
        Some("C:/bin/claude.exe".into())
    }
}

struct Setup {
    f: Fixture,
    admin: common::Agent,
    runtime: Arc<Runtime>,
    session: String,
    agent: i64,
}

async fn setup() -> Setup {
    let mut f = Fixture::new().await;
    let runtime = Arc::new(Runtime::default());
    f.app.attach_llm(
        Arc::new(LlmRouter::default().with("claude_cli", runtime.clone())),
        Duration::ZERO,
    );
    let session = f.session("Padaria").id;
    let admin = f.bootstrap().await;
    let inbox = admin.get("/inboxes").await.body[0]["id"].as_i64().unwrap();
    let p = profiles(&admin).await;
    let created = admin.post("/agent_directory", ai(&p, "Ana", "operator")).await;
    let agent = created.body["id"].as_i64().unwrap();
    let url = format!("/inboxes/{inbox}/ai_agent");
    assert_eq!(admin.post(&url, json!({ "ai_agent_id": agent })).await.status, 200);
    Setup {
        f,
        admin,
        runtime,
        session,
        agent,
    }
}

impl Setup {
    fn write(&self, id: &str, body: &str) {
        let message = Incoming {
            id,
            body,
            ..Default::default()
        };
        self.f.incoming(&self.session, message);
    }

    async fn pause(&self, paused: bool) {
        let url = format!("/agents/live/{}/paused", self.agent);
        let reply = self.admin.put(&url, json!({ "paused": paused })).await;
        assert_eq!(reply.status, 200, "{:?}", reply.body);
    }

    fn answers(&self) -> usize {
        let calls = self.runtime.calls.lock();
        calls.iter().filter(|c| !c.system.starts_with("Você resume")).count()
    }

    async fn live(&self) -> Value {
        let live = self.admin.get("/agents/live").await;
        assert_eq!(live.status, 200, "{:?}", live.body);
        live.body
    }
}

#[tokio::test]
async fn paused_agents_wait_and_waiting_conversations_are_answered_on_recovery() {
    let s = setup().await;
    s.pause(true).await;
    assert_eq!(s.live().await[0]["paused"], true);
    s.write("IN1", "Tem pão?");
    s.f.settle().await;
    assert_eq!(s.answers(), 0, "a paused agent does not answer");

    // As after a restart: the pause is gone and nothing is scheduled; recovery finds the
    // conversation still waiting for its agent.
    s.f.store.set_agent_paused(s.agent, false).unwrap();
    assert_eq!(s.f.app.llm_bots.as_ref().unwrap().recover().unwrap(), 1);
    s.f.settle().await;
    assert_eq!(s.answers(), 1);
    assert_eq!(s.f.wa.sent().last().unwrap().text, "Pode deixar!");
    assert_eq!(s.f.app.llm_bots.as_ref().unwrap().recover().unwrap(), 0, "answered");

    // Resuming over the API answers what came in while paused.
    s.pause(true).await;
    s.write("IN2", "E bolo?");
    s.f.settle().await;
    assert_eq!(s.answers(), 1);
    s.pause(false).await;
    s.f.settle().await;
    assert_eq!(s.answers(), 2);
}

#[tokio::test]
async fn stopping_an_answer_hands_the_conversation_to_people() {
    let s = setup().await;
    *s.runtime.hang.lock() = true;
    s.write("IN1", "Tem pão?");
    let mut runs = Value::Null;
    for _ in 0..200 {
        runs = s.admin.get("/agent_runs").await.body;
        if runs[0]["state"] == "running" {
            break;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    let run = &runs[0];
    assert_eq!(
        (run["kind"].as_str(), run["state"].as_str()),
        (Some("conversation"), Some("running")),
        "{runs}"
    );
    let id: i64 = run["id"]
        .as_str()
        .unwrap()
        .trim_start_matches("conversation:")
        .parse()
        .unwrap();

    let url = format!("/agents/live/conversations/{id}/stop");
    assert_eq!(s.admin.post(&url, json!({})).await.status, 200);
    s.f.settle().await;
    assert_eq!(s.admin.get("/agent_runs").await.body, json!([]));
    assert!(s.f.wa.sent().is_empty(), "nothing was sent");
    let number = run["display_id"].as_i64().unwrap();
    let conversation = s.admin.get(&format!("/conversations/{number}")).await.body;
    assert_eq!(conversation["status"], "open", "a person takes it over");
    assert!(conversation["assignee_id"].is_i64(), "{conversation}");

    let agent = s.f.agent(&s.admin, "bia@example.com", "agent", false).await;
    assert_eq!(agent.get("/agents/live").await.status, 403);
}

#[tokio::test]
async fn long_conversations_reach_the_agent_with_a_summary_of_the_start() {
    let s = setup().await;
    s.pause(true).await;
    for n in 0..45 {
        s.write(&format!("IN{n}"), &format!("Mensagem {n}"));
    }
    s.f.settle().await;
    s.pause(false).await;
    s.f.settle().await;
    let calls = s.runtime.calls.lock().clone();
    assert_eq!(calls.len(), 2, "one summary, one answer");
    assert!(calls[0].prompt.contains("Cliente: Mensagem 0"));
    assert!(
        !calls[0].prompt.contains("Mensagem 30"),
        "the latest messages stay out of it"
    );
    assert!(calls[1].prompt.starts_with("Resumo do começo da conversa"));
    assert!(calls[1].prompt.contains("Cliente Ana quer pães para a festa."));
    assert!(calls[1].prompt.contains("Cliente: Mensagem 44"));

    // The next answer reuses the summary: no new summary until the window moves past it.
    s.write("IN99", "Mais uma");
    s.f.settle().await;
    assert_eq!(s.runtime.calls.lock().len(), 3);
}
