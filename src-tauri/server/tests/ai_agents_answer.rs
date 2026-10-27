//! AI agents of the roster answer the inboxes connected to them through their runtime (a scripted
//! fake here), with their model, instructions, skills and OpenRouter key; the runtimes list says
//! which ones are installed.
mod agents_support;
mod common;

use agents_support::{ai, profiles};
use async_trait::async_trait;
use common::{Fixture, Incoming};
use parking_lot::Mutex;
use serde_json::{json, Value};
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;
use wamcp_server::adapters::outbound::llm::claude_cli::parse_output;
use wamcp_server::adapters::outbound::llm::codex_cli::{codex_arguments, parse_codex_answer};
use wamcp_server::adapters::outbound::llm::LlmRouter;
use wamcp_server::application::ports::{Llm, LlmRequest};
use wamcp_server::domain::error::Result;
use wamcp_server::domain::llm::openrouter_key;
use wamcp_server::domain::model::SealedCredential;

/// Records every request and always answers `reply`; reports itself installed at `location`.
struct FakeRuntime {
    calls: Mutex<Vec<LlmRequest>>,
    location: Option<String>,
}

#[async_trait]
impl Llm for FakeRuntime {
    async fn complete(&self, request: &LlmRequest) -> Result<Value> {
        self.calls.lock().push(request.clone());
        Ok(json!({ "reply": "Olá! Sou a Ana, da Padaria Sol.", "handoff": false }))
    }

    fn location(&self) -> Option<String> {
        self.location.clone()
    }
}

fn runtime(location: Option<&str>) -> Arc<FakeRuntime> {
    Arc::new(FakeRuntime {
        calls: Mutex::default(),
        location: location.map(String::from),
    })
}

struct Setup {
    f: Fixture,
    admin: common::Agent,
    claude: Arc<FakeRuntime>,
    openclaude: Arc<FakeRuntime>,
    session: String,
    inbox: i64,
}

async fn setup() -> Setup {
    let mut f = Fixture::new().await;
    let (claude, openclaude) = (runtime(Some("C:/bin/claude.exe")), runtime(None));
    let router = LlmRouter::default()
        .with("claude_cli", claude.clone())
        .with("openclaude", openclaude.clone());
    f.app.attach_llm(Arc::new(router), Duration::ZERO);
    let session = f.session("Padaria").id;
    let admin = f.bootstrap().await;
    let inbox = admin.get("/inboxes").await.body[0]["id"].as_i64().unwrap();
    Setup {
        f,
        admin,
        claude,
        openclaude,
        session,
        inbox,
    }
}

impl Setup {
    async fn agent(&self, body: Value) -> i64 {
        let created = self.admin.post("/agent_directory", body).await;
        assert_eq!(created.status, 201, "{:?}", created.body);
        created.body["id"].as_i64().unwrap()
    }

    async fn connect(&self, agent: Option<i64>) -> common::http::Reply {
        let url = format!("/inboxes/{}/ai_agent", self.inbox);
        self.admin.post(&url, json!({ "ai_agent_id": agent })).await
    }

    async fn write(&self, id: &str, body: &str) {
        let message = Incoming {
            id,
            body,
            ..Default::default()
        };
        self.f.incoming(&self.session, message);
        self.f.settle().await;
    }
}

#[tokio::test]
async fn the_connected_ai_agent_answers_through_its_runtime_with_its_skills() {
    let s = setup().await;
    let p = profiles(&s.admin).await;
    let mut body = ai(&p, "Ana", "operator");
    body["model"] = json!("haiku");
    let ana = s.agent(body).await;
    let skill = s
        .admin
        .post(
            "/skills",
            json!({ "name": "Horários", "instructions": "Abrimos às 7h e fechamos às 19h." }),
        )
        .await
        .body["id"]
        .clone();
    let url = format!("/agent_directory/{ana}/skills");
    assert_eq!(s.admin.put(&url, json!({ "skill_ids": [skill] })).await.status, 200);
    let connected = s.connect(Some(ana)).await;
    assert_eq!(connected.status, 200, "{:?}", connected.body);
    assert_eq!(connected.body["ai_agent_id"], ana);

    s.write("IN1", "Que horas vocês abrem?").await;
    let calls = s.claude.calls.lock().clone();
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0].model.as_deref(), Some("haiku"));
    assert!(calls[0].prompt.contains("Atenda com cordialidade."));
    assert!(calls[0].prompt.contains("Skill \"Horários\":\nAbrimos às 7h"));
    assert!(calls[0].prompt.contains("Cliente: Que horas vocês abrem?"));
    assert_eq!(calls[0].api_key, None);
    assert_eq!(s.f.wa.sent().last().unwrap().text, "Olá! Sou a Ana, da Padaria Sol.");
    assert_eq!(s.admin.get("/conversations/1").await.body["status"], "pending");

    // Deactivated, it stops answering (the conversation waits for a person).
    let mut off = ai(&p, "Ana", "operator");
    off["active"] = json!(false);
    assert_eq!(s.admin.put(&format!("/agent_directory/{ana}"), off).await.status, 200);
    s.write("IN2", "Alô?").await;
    assert_eq!(s.claude.calls.lock().len(), 1);
    assert_eq!(
        s.connect(Some(ana)).await.status,
        400,
        "inactive agents cannot be connected"
    );
    assert_eq!(s.connect(None).await.body["ai_agent_id"], Value::Null);
}

#[tokio::test]
async fn openclaude_agents_send_their_openrouter_key_and_only_executors_connect() {
    let s = setup().await;
    let p = profiles(&s.admin).await;
    let mut body = ai(&p, "Rota", "operator");
    body["runtime"] = json!("openclaude");
    body["model"] = json!("openai/gpt-4o-mini");
    let rota = s.agent(body).await;
    let url = format!("/agent_directory/{rota}/credentials");
    let key = json!({ "name": "OPENROUTER_API_KEY", "kind": "api_key", "secret": "sk-or-123" });
    assert_eq!(s.admin.post(&url, key).await.status, 201);
    assert_eq!(s.connect(Some(rota)).await.status, 200);
    s.write("IN1", "Oi").await;
    let calls = s.openclaude.calls.lock().clone();
    assert_eq!(calls.len(), 1);
    assert_eq!(
        (calls[0].provider.as_str(), calls[0].api_key.as_deref()),
        ("openclaude", Some("sk-or-123"))
    );
    assert!(s.claude.calls.lock().is_empty());

    let boss = s.agent(ai(&p, "Chefe", "coordinator")).await;
    assert_eq!(s.connect(Some(boss)).await.status, 400, "coordinators only delegate");
    let person = json!({ "name": "Bia", "kind": "human", "profile_id": p.builtin, "whatsapp": "5511988887777" });
    let bia = s.agent(person).await;
    assert_eq!(
        s.connect(Some(bia)).await.status,
        400,
        "people are not run by a runtime"
    );
    assert_eq!(s.connect(Some(9999)).await.status, 404);
}

#[tokio::test]
async fn runtimes_list_says_what_is_installed() {
    let s = setup().await;
    let list = s.admin.get("/agent_runtimes").await.body;
    let ids: Vec<_> = list.as_array().unwrap().iter().map(|r| r["id"].clone()).collect();
    assert_eq!(ids, vec![json!("claude_cli"), json!("codex_cli"), json!("openclaude")]);
    assert_eq!(
        (list[0]["available"].clone(), list[0]["detail"].clone()),
        (json!(true), json!("C:/bin/claude.exe"))
    );
    assert_eq!(list[1]["available"], false, "not registered in this router");
    assert_eq!(list[2]["available"], false, "registered but not installed");
    let agent = s.f.agent(&s.admin, "op@example.com", "agent", false).await;
    assert_eq!(agent.get("/agent_runtimes").await.status, 403);
}

#[test]
fn openrouter_key_prefers_the_named_credential_else_the_only_key() {
    let credential = |name: &str, kind: &str| SealedCredential {
        name: name.into(),
        kind: kind.into(),
        secret: format!("sealed-{name}"),
    };
    let both = [credential("ERP", "api_key"), credential("openrouter_api_key", "secret")];
    assert_eq!(openrouter_key(&both).unwrap().name, "openrouter_api_key");
    let only = [credential("CHAVE", "bearer"), credential("SENHA", "basic")];
    assert_eq!(openrouter_key(&only).unwrap().name, "CHAVE");
    let many = [credential("A", "api_key"), credential("B", "api_key")];
    assert_eq!(openrouter_key(&many), None, "ambiguous");
}

#[test]
fn codex_and_claude_outputs_are_read_back() {
    let request = LlmRequest {
        provider: "codex_cli".into(),
        model: Some("gpt-5-mini".into()),
        system: "Sistema".into(),
        prompt: "Cliente: oi".into(),
        schema: json!({ "type": "object" }),
        api_key: None,
    };
    let args = codex_arguments(&request, Path::new("s.json"), Path::new("a.txt"));
    let after = |flag: &str| args[args.iter().position(|a| a == flag).unwrap() + 1].clone();
    assert_eq!(args[0], "exec");
    assert_eq!(after("--sandbox"), "read-only");
    assert_eq!(after("--output-schema"), "s.json");
    assert_eq!(after("--output-last-message"), "a.txt");
    assert_eq!(after("--model"), "gpt-5-mini");
    assert_eq!(args.last().unwrap(), "-", "prompt from stdin");
    assert!(!args.iter().any(|a| a.contains("oi")));

    let fenced = "```json\n{\"reply\":\"Oi\",\"handoff\":false}\n```";
    assert_eq!(parse_codex_answer(fenced, b"").unwrap()["reply"], "Oi");
    let error = parse_codex_answer("", b"warn\nNot logged in\n")
        .unwrap_err()
        .to_string();
    assert!(error.contains("Not logged in"));

    let inline = br#"{"type":"result","is_error":false,"result":"{\"reply\":\"Oi\",\"handoff\":true}"}"#;
    assert_eq!(parse_output(inline, b"").unwrap()["handoff"], true);
}
