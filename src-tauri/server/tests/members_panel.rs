//! The "Funcionários" panel: every LLM call of an AI agent records its tokens and cost, so its
//! salary starts the month at zero and grows with the work (cost plus the margin), while people cost
//! a fixed seat; the hierarchy (who answers to whom) never loops; avatars only take known choices.
mod agents_support;
mod common;

use agents_support::{ai, profiles};
use async_trait::async_trait;
use common::{Fixture, Incoming};
use serde_json::{json, Value};
use std::sync::Arc;
use std::time::Duration;
use wamcp_server::adapters::outbound::llm::claude_cli::parse_usage;
use wamcp_server::adapters::outbound::llm::codex_cli::codex_usage;
use wamcp_server::adapters::outbound::llm::LlmRouter;
use wamcp_server::application::ports::{Completion, Llm, LlmRequest, TokenUsage};
use wamcp_server::domain::error::Result;

/// Answers every call and reports 1 200 tokens in, 300 out, for two cents.
struct MeteredRuntime;

#[async_trait]
impl Llm for MeteredRuntime {
    async fn complete(&self, _request: &LlmRequest) -> Result<Completion> {
        Ok(Completion {
            answer: json!({ "reply": "Oi! Como posso ajudar?", "handoff": false }),
            usage: TokenUsage {
                input_tokens: 1200,
                cached_input_tokens: 1000,
                output_tokens: 300,
                cost_usd: Some(0.02),
            },
        })
    }

    fn location(&self) -> Option<String> {
        Some("C:/bin/claude.exe".into())
    }
}

fn salary_of(sheet: &Value, agent: i64) -> Value {
    sheet["salaries"]
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["agent_id"] == agent)
        .cloned()
        .unwrap()
}

#[tokio::test]
async fn ai_salaries_start_at_zero_and_grow_with_each_call_people_cost_the_seat() {
    let mut f = Fixture::new().await;
    let router = LlmRouter::default().with("claude_cli", Arc::new(MeteredRuntime));
    f.app.attach_llm(Arc::new(router), Duration::ZERO);
    let session = f.session("Software house").id;
    let admin = f.bootstrap().await;
    let p = profiles(&admin).await;
    let inbox = admin.get("/inboxes").await.body[0]["id"].as_i64().unwrap();
    let lu = admin.post("/agent_directory", ai(&p, "Lu", "operator")).await.body["id"]
        .as_i64()
        .unwrap();
    let joao = json!({ "name": "João", "kind": "human", "profile_id": p.builtin, "whatsapp": "5511999990000" });
    let joao = admin.post("/agent_directory", joao).await.body["id"].as_i64().unwrap();

    let sheet = admin.get("/agent_directory/salaries").await;
    assert_eq!(sheet.status, 200, "{:?}", sheet.body);
    assert_eq!(salary_of(&sheet.body, lu)["salary_brl"], 0.0);
    assert_eq!(salary_of(&sheet.body, joao)["salary_brl"], 50.0);
    assert_eq!(sheet.body["rates"]["ai_margin_percent"], 50.0);

    let url = format!("/inboxes/{inbox}/ai_agent");
    assert_eq!(admin.post(&url, json!({ "ai_agent_id": lu })).await.status, 200);
    for (id, body) in [("IN1", "Oi"), ("IN2", "Vocês fazem apps?")] {
        let message = Incoming {
            id,
            body,
            ..Default::default()
        };
        f.incoming(&session, message);
        f.settle().await;
    }

    let sheet = admin.get("/agent_directory/salaries").await.body;
    let lu_salary = salary_of(&sheet, lu);
    assert_eq!(lu_salary["calls"], 2);
    assert_eq!(lu_salary["input_tokens"], 2400);
    assert_eq!(lu_salary["output_tokens"], 600);
    // US$ 0,04 × R$ 5,50 × 1,5 (margem de 50%).
    assert_eq!(lu_salary["salary_brl"], 0.33);

    let changed = json!({ "seat_price_brl": 80.0, "ai_margin_percent": 100.0, "usd_brl_rate": 5.0 });
    assert_eq!(admin.patch("/account", changed).await.status, 200);
    let sheet = admin.get("/agent_directory/salaries").await.body;
    assert_eq!(salary_of(&sheet, lu)["salary_brl"], 0.4);
    assert_eq!(salary_of(&sheet, joao)["salary_brl"], 80.0);
    let invalid = json!({ "usd_brl_rate": 0.0 });
    assert_eq!(admin.patch("/account", invalid).await.status, 400);

    // Other months start from zero; the chart has today's tokens.
    let past = admin.get("/agent_directory/salaries?month=2020-01").await.body;
    assert_eq!(salary_of(&past, lu)["salary_brl"], 0.0);
    assert_eq!(admin.get("/agent_directory/salaries?month=jan").await.status, 400);
    let days = admin.get(&format!("/agent_directory/{lu}/usage?days=30")).await.body;
    assert_eq!(days.as_array().unwrap().len(), 1);
    assert_eq!(days[0]["input_tokens"], 2400);
    assert_eq!(days[0]["cost_usd"], 0.04);
}

#[tokio::test]
async fn the_hierarchy_never_loops() {
    let f = Fixture::new().await;
    let admin = f.bootstrap().await;
    let p = profiles(&admin).await;
    let create = |name: &str, role: &str, boss: Option<i64>| {
        let mut body = ai(&p, name, role);
        body["supervisor_id"] = json!(boss);
        body
    };
    let anny = admin
        .post("/agent_directory", create("Anny", "coordinator", None))
        .await;
    let anny = anny.body["id"].as_i64().unwrap();
    let julio = admin.post("/agent_directory", create("Julio", "qa", Some(anny))).await;
    assert_eq!(julio.status, 201, "{:?}", julio.body);
    assert_eq!(julio.body["supervisor_id"], anny);
    let julio = julio.body["id"].as_i64().unwrap();

    let looped = admin
        .put(
            &format!("/agent_directory/{anny}"),
            create("Anny", "coordinator", Some(julio)),
        )
        .await;
    assert_eq!(looped.status, 400);
    assert!(looped.body.to_string().contains("ciclo"));
    let own = admin
        .put(
            &format!("/agent_directory/{anny}"),
            create("Anny", "coordinator", Some(anny)),
        )
        .await;
    assert_eq!(own.status, 400);
    let missing = admin.post("/agent_directory", create("Ghost", "qa", Some(999))).await;
    assert_eq!(missing.status, 400);

    // Removing the boss leaves the agent without one.
    assert_eq!(admin.del(&format!("/agent_directory/{anny}"), None).await.status, 200);
    let roster = admin.get("/agent_directory").await.body;
    let julio = roster.as_array().unwrap().iter().find(|a| a["id"] == julio).unwrap();
    assert_eq!(julio["supervisor_id"], Value::Null);
}

#[tokio::test]
async fn avatars_take_only_known_choices() {
    let f = Fixture::new().await;
    let admin = f.bootstrap().await;
    let p = profiles(&admin).await;
    let lu = admin.post("/agent_directory", ai(&p, "Lu", "operator")).await.body["id"]
        .as_i64()
        .unwrap();
    let url = format!("/agent_directory/{lu}/avatar");
    let saved = admin
        .put(
            &url,
            json!({ "hair": "curly", "accessory": "headset", "color": "violet" }),
        )
        .await;
    assert_eq!(saved.status, 200, "{:?}", saved.body);
    assert_eq!(saved.body["avatar"]["hair"], "curly");
    assert_eq!(admin.put(&url, json!({ "hair": "mohawk" })).await.status, 400);
    assert_eq!(admin.put(&url, json!({ "wings": "yes" })).await.status, 400);
}

#[test]
fn runtimes_report_tokens_and_cost() {
    let claude = br#"{"type":"result","is_error":false,"total_cost_usd":0.0123,
        "usage":{"input_tokens":10,"cache_creation_input_tokens":100,"cache_read_input_tokens":1000,"output_tokens":50}}"#;
    let claude: Vec<u8> = claude.iter().copied().filter(|b| *b != b'\n').collect();
    let usage = parse_usage(&claude);
    assert_eq!(
        (usage.input_tokens, usage.cached_input_tokens, usage.output_tokens),
        (1110, 1000, 50)
    );
    assert_eq!(usage.cost_usd, Some(0.0123));
    assert_eq!(parse_usage(b"not json"), TokenUsage::default());

    let codex = b"{\"type\":\"thread.started\"}\n{\"type\":\"turn.completed\",\"usage\":{\"input_tokens\":900,\"cached_input_tokens\":400,\"output_tokens\":70}}\n";
    let usage = codex_usage(codex);
    assert_eq!(
        (usage.input_tokens, usage.output_tokens, usage.cost_usd),
        (900, 70, None)
    );
}
