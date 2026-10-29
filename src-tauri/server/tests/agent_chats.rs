//! People logged in talk with AI agents in private chats inside the app: the agent answers through
//! its runtime (a scripted fake here), nothing goes to WhatsApp, other people never see the chat,
//! and the system agent talks only with administrators and changes nothing without their approval.
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
use wamcp_server::application::ports::{AgentsRepo, Completion, Llm, LlmRequest, TokenUsage, UsersRepo};
use wamcp_server::application::system_agent::SystemAgent;
use wamcp_server::domain::error::{fail, Result};

/// The system agent proposes a skill on its first run and tries to execute it on every run; other
/// agents greet. `broken` makes every call fail.
struct Scripted {
    system: SystemAgent,
    requests: Mutex<Vec<LlmRequest>>,
    outcomes: Mutex<Vec<Value>>,
    broken: bool,
}

#[async_trait]
impl Llm for Scripted {
    async fn complete(&self, request: &LlmRequest) -> Result<Completion> {
        self.requests.lock().push(request.clone());
        if self.broken {
            return fail("o runtime caiu");
        }
        let usage = TokenUsage {
            input_tokens: 500,
            output_tokens: 50,
            cost_usd: Some(0.002),
            ..TokenUsage::default()
        };
        let Some(mcp) = &request.mcp else {
            let answer = json!({ "reply": "Oi! Posso ajudar com os boletos." });
            return Ok(Completion { answer, usage });
        };
        let first = self.outcomes.lock().is_empty();
        if first {
            let skill = json!({ "name": "Financeiro", "instructions": "Responda sobre boletos." });
            let proposed = self.system.call(&mcp.token, "propose_skill", &skill)?;
            self.outcomes.lock().push(proposed);
        }
        let executed = self.system.call(&mcp.token, "execute_proposal", &json!({ "id": 1 }));
        self.outcomes
            .lock()
            .push(executed.unwrap_or_else(|e| json!({ "error": e.to_string() })));
        let reply = if first {
            "Proposta 1: criar a skill Financeiro. Aprova?"
        } else {
            "Feito."
        };
        Ok(Completion {
            answer: json!({ "reply": reply }),
            usage,
        })
    }

    fn location(&self) -> Option<String> {
        Some("C:/bin/claude.exe".into())
    }
}

struct Setup {
    f: Fixture,
    admin: common::Agent,
    runtime: Arc<Scripted>,
    ana: i64,
}

async fn setup(broken: bool) -> Setup {
    let mut f = Fixture::new().await;
    let runtime = Arc::new(Scripted {
        system: f.app.state.support().system.clone(),
        requests: Mutex::default(),
        outcomes: Mutex::default(),
        broken,
    });
    f.app.attach_llm(
        Arc::new(LlmRouter::default().with("claude_cli", runtime.clone())),
        Duration::ZERO,
    );
    let _ = f.app.mcp_url.set("http://127.0.0.1:1/mcp-system".into());
    f.session("Loja");
    let admin = f.bootstrap().await;
    let p = profiles(&admin).await;
    let created = admin.post("/agent_directory", ai(&p, "Ana", "operator")).await;
    assert_eq!(created.status, 201, "{:?}", created.body);
    let ana = created.body["id"].as_i64().unwrap();
    Setup { f, admin, runtime, ana }
}

impl Setup {
    async fn say(&self, who: &common::Agent, agent: i64, text: &str) -> common::http::Reply {
        let sent = who
            .post(&format!("/agent_chats/{agent}/messages"), json!({ "content": text }))
            .await;
        self.f.settle().await;
        sent
    }

    async fn chat(&self, who: &common::Agent, agent: i64) -> Vec<(String, String)> {
        let messages = who.get(&format!("/agent_chats/{agent}/messages")).await.body;
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

    fn system_id(&self) -> i64 {
        self.f.store.system_agent().unwrap().unwrap().id
    }
}

fn names(list: &Value) -> Vec<&str> {
    list.as_array()
        .unwrap()
        .iter()
        .map(|a| a["name"].as_str().unwrap())
        .collect()
}

#[tokio::test]
async fn people_talk_with_ai_agents_in_private_chats() {
    let s = setup(false).await;
    let maria = s.f.agent(&s.admin, "maria@example.com", "agent", false).await;
    let listed = maria.get("/agent_chats").await.body;
    assert_eq!(names(&listed), ["Ana"], "the system agent is for administrators only");
    assert!(
        listed[0].get("instructions").is_none(),
        "no instructions in the chat list"
    );

    let sent = s.say(&maria, s.ana, "  Oi, Ana!  ").await;
    assert_eq!(sent.status, 201, "{:?}", sent.body);
    assert_eq!(sent.body["content"], "Oi, Ana!");
    assert_eq!(
        s.chat(&maria, s.ana).await,
        [
            ("user".to_string(), "Oi, Ana!".to_string()),
            ("agent".to_string(), "Oi! Posso ajudar com os boletos.".to_string())
        ]
    );
    let request = s.runtime.requests.lock()[0].clone();
    assert!(request.system.contains("pessoa da equipe (não com um cliente)"));
    assert!(
        request.prompt.contains("Atenda com cordialidade."),
        "the agent's instructions"
    );
    assert!(request.prompt.contains("maria: Oi, Ana!"), "{}", request.prompt);
    assert!(s.f.wa.sent().is_empty(), "nothing goes to WhatsApp");

    // The chat list shows the newest message; the admin has a chat of their own, still empty.
    assert_eq!(maria.get("/agent_chats").await.body[0]["last"]["role"], "agent");
    assert!(
        s.chat(&s.admin, s.ana).await.is_empty(),
        "each person has their own chat"
    );

    // Its events reach only Maria, not even the administrator.
    let admin_user = s.f.store.user(s.admin.user["id"].as_i64().unwrap()).unwrap().unwrap();
    let maria_user = s.f.store.user(maria.user["id"].as_i64().unwrap()).unwrap().unwrap();
    let notifications = &s.f.app.state.support().notifications;
    let events = s.f.events.lock().clone();
    let chat_events: Vec<_> = events.iter().filter(|e| e.event == "agent_chat.message").collect();
    assert_eq!(chat_events.len(), 2);
    assert!(chat_events.iter().all(|e| notifications.visible_to(&maria_user, e)));
    assert!(chat_events.iter().all(|e| !notifications.visible_to(&admin_user, e)));

    // Its tokens count in the agent's salary.
    let totals =
        s.f.store
            .usage_totals("2000-01-01T00:00:00Z", "2100-01-01T00:00:00Z")
            .unwrap();
    let ana = totals.iter().find(|t| t.agent_id == s.ana).unwrap();
    assert_eq!((ana.calls, ana.input_tokens), (1, 500));

    assert!(
        s.say(&maria, s.ana, "   ").await.status >= 400,
        "empty messages are refused"
    );
}

#[tokio::test]
async fn the_system_agent_talks_only_with_administrators_and_waits_for_approval() {
    let s = setup(false).await;
    let system = s.system_id();
    let maria = s.f.agent(&s.admin, "maria@example.com", "agent", false).await;
    assert_eq!(s.say(&maria, system, "Crie um agente").await.status, 404);
    assert!(s.runtime.requests.lock().is_empty());

    assert_eq!(
        names(&s.admin.get("/agent_chats").await.body)[0],
        "Sistema",
        "listed first"
    );
    s.say(&s.admin, system, "Crie uma skill de financeiro").await;
    let outcomes = s.runtime.outcomes.lock().clone();
    assert_eq!(outcomes[0]["proposal_id"], 1);
    assert!(
        outcomes[1]["error"].as_str().unwrap().contains("ainda não respondeu"),
        "no self-approval"
    );
    let request = s.runtime.requests.lock()[0].clone();
    assert!(request.mcp.is_some(), "the system agent gets the app's tools");
    assert!(!names(&s.admin.get("/skills").await.body).contains(&"Financeiro"));

    // Approved in a new message of the same chat, the proposal runs.
    s.say(&s.admin, system, "Aprovo").await;
    assert_eq!(s.runtime.outcomes.lock().last().unwrap()["status"], "done");
    assert!(names(&s.admin.get("/skills").await.body).contains(&"Financeiro"));
    let chat = s.chat(&s.admin, system).await;
    assert_eq!(chat.last().unwrap(), &("agent".to_string(), "Feito.".to_string()));
    assert!(s.f.wa.sent().is_empty());
}

#[tokio::test]
async fn a_failed_answer_shows_up_in_the_chat() {
    let s = setup(true).await;
    s.say(&s.admin, s.ana, "Oi").await;
    let chat = s.chat(&s.admin, s.ana).await;
    assert_eq!(chat.len(), 2);
    assert_eq!(chat[1].0, "error");
    assert!(chat[1].1.starts_with("Não consegui responder:"), "{}", chat[1].1);
    assert!(chat[1].1.contains("o runtime caiu"));
}
