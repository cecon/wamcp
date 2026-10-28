//! The system agent: administrators talk to it on WhatsApp from the number of their roster entry; it
//! calls the app's tools during its run (a scripted fake runtime here) and a proposal only runs after
//! the administrator approves it in a later message. Customers never reach it.
mod agents_support;
mod common;

use async_trait::async_trait;
use common::http::request;
use common::{Fixture, Incoming};
use parking_lot::Mutex;
use serde_json::{json, Value};
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;
use wamcp_server::adapters::outbound::llm::claude_cli::{mcp_arguments, mcp_config};
use wamcp_server::adapters::outbound::llm::LlmRouter;
use wamcp_server::application::ports::{AgentsRepo, Completion, Llm, LlmMcp, LlmRequest, TokenUsage, UsersRepo};
use wamcp_server::application::system_agent::SystemAgent;
use wamcp_server::domain::error::Result;

const ADMIN_JID: &str = "5511911112222@s.whatsapp.net";

/// Proposes a skill on the first run and tries to execute it on every run; records the outcomes.
struct ScriptedSystem {
    system: SystemAgent,
    requests: Mutex<Vec<LlmRequest>>,
    outcomes: Mutex<Vec<Value>>,
}

#[async_trait]
impl Llm for ScriptedSystem {
    async fn complete(&self, request: &LlmRequest) -> Result<Completion> {
        self.requests.lock().push(request.clone());
        let Some(mcp) = &request.mcp else {
            return Ok(json!({ "reply": "cliente", "handoff": false }).into());
        };
        let first = self.requests.lock().len() == 1;
        if first {
            let skill = json!({ "name": "Financeiro", "instructions": "Responda sobre boletos.", "tools": ["get_conversation"] });
            let proposed = self.system.call(&mcp.token, "propose_skill", &skill)?;
            self.outcomes.lock().push(proposed);
        }
        let executed = self.system.call(&mcp.token, "execute_proposal", &json!({ "id": 1 }));
        let outcome = executed.unwrap_or_else(|e| json!({ "error": e.to_string() }));
        self.outcomes.lock().push(outcome);
        Ok(Completion {
            answer: json!({ "reply": if first { "Proposta 1: criar a skill Financeiro. Aprova?" } else { "Feito." } }),
            usage: TokenUsage {
                input_tokens: 1000,
                output_tokens: 100,
                cost_usd: Some(0.01),
                ..TokenUsage::default()
            },
        })
    }

    fn location(&self) -> Option<String> {
        Some("C:/bin/claude.exe".into())
    }
}

struct Setup {
    f: Fixture,
    admin: common::Agent,
    runtime: Arc<ScriptedSystem>,
    session: String,
}

async fn setup() -> Setup {
    let mut f = Fixture::new().await;
    let runtime = Arc::new(ScriptedSystem {
        system: f.app.state.support().system.clone(),
        requests: Mutex::default(),
        outcomes: Mutex::default(),
    });
    f.app.attach_llm(
        Arc::new(LlmRouter::default().with("claude_cli", runtime.clone())),
        Duration::ZERO,
    );
    let _ = f.app.mcp_url.set("http://127.0.0.1:1/mcp-system".into());
    let session = f.session("Loja").id;
    let admin = f.bootstrap().await;
    let me = admin
        .get("/agent_directory")
        .await
        .body
        .as_array()
        .unwrap()
        .iter()
        .find(|a| a["user_id"].is_i64())
        .unwrap()
        .clone();
    let body = json!({ "name": me["name"], "kind": "human", "profile_id": me["profile_id"], "user_id": me["user_id"], "whatsapp": "+55 11 91111-2222" });
    let saved = admin.put(&format!("/agent_directory/{}", me["id"]), body).await;
    assert_eq!(saved.status, 200, "{:?}", saved.body);
    Setup {
        f,
        admin,
        runtime,
        session,
    }
}

impl Setup {
    async fn write(&self, jid: &str, id: &str, body: &str) {
        let message = Incoming {
            id,
            jid,
            body,
            ..Default::default()
        };
        self.f.incoming(&self.session, message);
        self.f.settle().await;
    }
}

#[tokio::test]
async fn an_administrator_approves_what_the_system_agent_proposes() {
    let s = setup().await;
    s.write(ADMIN_JID, "A1", "Crie uma skill de financeiro").await;
    let requests = s.runtime.requests.lock().clone();
    assert_eq!(requests.len(), 1);
    let mcp = requests[0].mcp.clone().expect("the run gets the app's MCP server");
    assert_eq!(
        (mcp.name.as_str(), mcp.url.as_str()),
        ("wamcp", "http://127.0.0.1:1/mcp-system")
    );
    assert!(requests[0].prompt.contains("## Como o app funciona"));
    assert!(requests[0]
        .prompt
        .contains("Administrador: Crie uma skill de financeiro"));
    let outcomes = s.runtime.outcomes.lock().clone();
    assert_eq!(outcomes[0]["proposal_id"], 1);
    assert!(
        outcomes[1]["error"].as_str().unwrap().contains("ainda não respondeu"),
        "no self-approval"
    );
    assert_eq!(
        s.f.wa.sent().last().unwrap().text,
        "Proposta 1: criar a skill Financeiro. Aprova?"
    );
    assert!(!s.admin.get("/skills").await.body.to_string().contains("Financeiro"));
    // The run ended: its token no longer reaches the tools.
    assert!(s.runtime.system.call(&mcp.token, "list_agents", &json!({})).is_err());

    s.write(ADMIN_JID, "A2", "Aprovo").await;
    let outcomes = s.runtime.outcomes.lock().clone();
    assert_eq!(outcomes[2]["status"], "done", "{outcomes:?}");
    assert!(s.admin.get("/skills").await.body.to_string().contains("Financeiro"));
    assert_eq!(s.f.wa.sent().last().unwrap().text, "Feito.");
    // Both runs count in llm_usage, on the system agent's own card.
    let system = s.f.store.system_agent().unwrap().unwrap();
    let totals =
        s.f.store
            .usage_totals("1970-01-01T00:00:00Z", "9999-01-01T00:00:00Z")
            .unwrap();
    let own = totals
        .iter()
        .find(|t| t.agent_id == system.id)
        .expect("system agent usage");
    assert_eq!((own.calls, own.input_tokens, own.output_tokens), (2, 2000, 200));
}

#[tokio::test]
async fn customers_never_reach_the_system_agent() {
    let s = setup().await;
    s.write("5511988887777@s.whatsapp.net", "C1", "Crie um agente").await;
    assert!(s.runtime.requests.lock().iter().all(|r| r.mcp.is_none()));
}

#[tokio::test]
async fn the_system_agent_stays_in_the_app() {
    let s = setup().await;
    let list = s.admin.get("/agent_directory").await.body;
    let system = list
        .as_array()
        .unwrap()
        .iter()
        .find(|a| a["system"] == true)
        .unwrap()
        .clone();
    assert_eq!(
        (system["name"].as_str(), system["runtime"].as_str()),
        (Some("Sistema"), Some("claude_cli"))
    );
    let id = system["id"].as_i64().unwrap();
    assert_eq!(s.admin.del(&format!("/agent_directory/{id}"), None).await.status, 409);
    let inbox = s.admin.get("/inboxes").await.body[0]["id"].as_i64().unwrap();
    let connected = s
        .admin
        .post(&format!("/inboxes/{inbox}/ai_agent"), json!({ "ai_agent_id": id }))
        .await;
    assert_eq!(connected.status, 400, "{:?}", connected.body);
    let body = json!({ "name": "Sistema", "kind": "ai", "profile_id": system["profile_id"], "runtime": "codex_cli" });
    assert_eq!(s.admin.put(&format!("/agent_directory/{id}"), body).await.status, 400);
}

#[tokio::test]
async fn the_mcp_endpoint_only_serves_a_run_in_progress() {
    let s = setup().await;
    let call = json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/list" });
    let denied =
        s.f.public(request(
            "POST",
            "/mcp-system",
            Some(call.clone()),
            &[("authorization", "Bearer wsys_x")],
        ))
        .await;
    assert_eq!(denied.status, 401);
    let system = s.f.app.state.support().system.clone();
    let user = s.f.store.users().unwrap().remove(0);
    let token = system.open_run(1, user);
    let auth = format!("Bearer {token}");
    let listed =
        s.f.public(request("POST", "/mcp-system", Some(call), &[("authorization", &auth)]))
            .await;
    assert_eq!(listed.status, 200, "{:?}", listed.body);
    assert!(listed.body["result"]["tools"].to_string().contains("propose_agent"));
    let tunnel = [("authorization", auth.as_str()), ("cf-connecting-ip", "1.2.3.4")];
    let body = json!({ "jsonrpc": "2.0", "id": 2, "method": "ping" });
    assert_eq!(
        s.f.public(request("POST", "/mcp-system", Some(body), &tunnel))
            .await
            .status,
        404
    );
    system.close_run(&token);
}

#[test]
fn claude_code_gets_only_the_runs_server_with_its_token_in_a_file() {
    let mcp = LlmMcp {
        name: "wamcp".into(),
        url: "http://127.0.0.1:9/mcp-system".into(),
        token: "wsys_t".into(),
    };
    let config = mcp_config(&mcp);
    assert_eq!(
        config["mcpServers"]["wamcp"]["headers"]["Authorization"],
        "Bearer wsys_t"
    );
    assert_eq!(config["mcpServers"]["wamcp"]["type"], "http");
    assert_eq!(
        config["mcpServers"]["wamcp"]["alwaysLoad"], true,
        "connected before the model starts"
    );
    let args = mcp_arguments(&mcp, Path::new("mcp.json"));
    assert_eq!(args, ["--mcp-config", "mcp.json", "--allowedTools", "mcp__wamcp"]);
}

/// The real Claude Code on this computer (with the operator's login) calls the app's tools on a
/// running server: `cargo test --test system_agent -- --ignored`.
#[tokio::test]
#[ignore = "runs the local Claude Code with the operator's subscription"]
async fn real_claude_code_calls_the_app_tools() {
    use wamcp_server::adapters::outbound::llm::claude_cli::ClaudeCli;
    use wamcp_server::domain::model::User;
    use wamcp_server::server::{run, Config};
    let dir = tempfile::tempdir().unwrap();
    let config = Config {
        data_dir: dir.path().to_path_buf(),
        bind: "127.0.0.1".parse().unwrap(),
        port: 0,
        public_url: "http://127.0.0.1".into(),
        web_dirs: vec![],
    };
    let running = run(config).await.unwrap();
    let admin: User = serde_json::from_value(json!({ "id": 1, "account_id": 1, "email": "a@b.c", "name": "Admin",
        "display_name": null, "role": "administrator", "availability": "online", "active": 1,
        "created": "2026-01-01T00:00:00Z", "last_login": null }))
    .unwrap();
    let system = running.app.state.support().system.clone();
    let token = system.open_run(1, admin);
    let request = LlmRequest {
        provider: "claude_cli".into(),
        model: Some("haiku".into()),
        system: "Use as ferramentas do servidor wamcp.".into(),
        prompt: "Chame list_agents e responda só com o nome do agente que tem system=true.".into(),
        schema: wamcp_server::domain::system::reply_schema(),
        api_key: None,
        mcp: Some(LlmMcp {
            name: "wamcp".into(),
            url: running.app.mcp_url.get().unwrap().clone(),
            token: token.clone(),
        }),
    };
    let answer = ClaudeCli::new(dir.path().join("claude")).complete(&request).await;
    system.close_run(&token);
    running.stop().await;
    let answer = answer.unwrap().answer;
    assert!(answer["reply"].as_str().unwrap().contains("Sistema"), "{answer}");
}
