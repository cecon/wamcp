//! Shared setup of the agent schedule tests: an administrator, the AI agent Ana and a runtime that
//! answers once its gate lets the call through.
#![allow(dead_code)]
use super::agents_support::{ai, profiles};
use super::common::{self, Fixture};
use async_trait::async_trait;
use parking_lot::Mutex;
use serde_json::{json, Value};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Semaphore;
use wamcp_server::adapters::outbound::llm::LlmRouter;
use wamcp_server::application::agent_schedules::AgentScheduleService;
use wamcp_server::application::ports::{Completion, Llm, LlmRequest, TokenUsage};
use wamcp_server::domain::error::Result;

/// Answers every call once the gate lets it through.
pub struct Gated {
    pub gate: Semaphore,
    pub requests: Mutex<Vec<LlmRequest>>,
}

#[async_trait]
impl Llm for Gated {
    async fn complete(&self, request: &LlmRequest) -> Result<Completion> {
        self.requests.lock().push(request.clone());
        self.gate.acquire().await.expect("gate").forget();
        let n = self.requests.lock().len();
        Ok(Completion {
            answer: json!({ "reply": format!("Relatório {n}: 3 conversas sem resposta.") }),
            usage: TokenUsage {
                input_tokens: 500,
                output_tokens: 50,
                cost_usd: Some(0.002),
                ..TokenUsage::default()
            },
        })
    }

    fn location(&self) -> Option<String> {
        Some("C:/bin/claude.exe".into())
    }
}

pub struct Setup {
    pub f: Fixture,
    pub admin: common::Agent,
    pub runtime: Arc<Gated>,
    pub ana: i64,
}

pub async fn setup(permits: usize) -> Setup {
    let mut f = Fixture::new().await;
    let runtime = Arc::new(Gated {
        gate: Semaphore::new(permits),
        requests: Mutex::default(),
    });
    f.app.attach_llm(
        Arc::new(LlmRouter::default().with("claude_cli", runtime.clone())),
        Duration::ZERO,
    );
    f.session("Loja");
    let admin = f.bootstrap().await;
    let p = profiles(&admin).await;
    let created = admin.post("/agent_directory", ai(&p, "Ana", "operator")).await;
    assert_eq!(created.status, 201, "{:?}", created.body);
    let ana = created.body["id"].as_i64().unwrap();
    Setup { f, admin, runtime, ana }
}

impl Setup {
    pub fn schedules(&self) -> &AgentScheduleService {
        &self.f.app.state.support().schedules
    }

    pub async fn create(&self, body: Value) -> Value {
        let created = self.admin.post("/agent_schedules", body).await;
        assert_eq!(created.status, 201, "{:?}", created.body);
        created.body
    }

    pub async fn runs(&self, schedule: &Value) -> Vec<(String, Option<String>)> {
        let runs = self
            .admin
            .get(&format!("/agent_schedules/{}/runs", schedule["id"]))
            .await;
        assert_eq!(runs.status, 200, "{:?}", runs.body);
        runs.body
            .as_array()
            .unwrap()
            .iter()
            .map(|r| {
                (
                    r["status"].as_str().unwrap().into(),
                    r["output"].as_str().map(Into::into),
                )
            })
            .collect()
    }

    pub async fn chat(&self) -> Vec<(String, String)> {
        let messages = self
            .admin
            .get(&format!("/agent_chats/{}/messages", self.ana))
            .await
            .body;
        messages
            .as_array()
            .unwrap()
            .iter()
            .map(|m| {
                (
                    m["role"].as_str().unwrap().into(),
                    m["content"].as_str().unwrap().into(),
                )
            })
            .collect()
    }
}

pub fn hourly(agent: i64) -> Value {
    json!({ "name": "Pendências", "interval_minutes": 60, "prompt": "Liste as conversas sem resposta.",
            "agent_ids": [agent] })
}
