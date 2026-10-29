//! The engine through the app: administrators start and inspect activities, set policies and
//! grants over HTTP; agent runtimes reach the tools only through `/engine/mcp` with a live run token.
mod common;
mod engine_support;

use common::http::request;
use common::Fixture;
use engine_support::{seed, standard, ScriptedRuntime};
use serde_json::{json, Value};
use std::sync::Arc;
use std::time::Duration;
use wamcp_server::application::ports::{AgentRuntime, EngineRepo};

async fn mcp(f: &Fixture, token: &str, body: Value, origin: bool) -> common::http::Reply {
    let bearer = format!("Bearer {token}");
    let mut headers = vec![("authorization", bearer.as_str())];
    if origin {
        headers.push(("origin", "https://evil.example"));
    }
    f.public(request("POST", "/engine/mcp", Some(body), &headers)).await
}

#[tokio::test]
async fn administrators_run_and_inspect_activities_over_http() {
    let f = Fixture::new().await;
    let admin = f.bootstrap().await;
    let org = seed(&f.store, 1);
    let runtime = Arc::new(ScriptedRuntime::default());
    standard(&runtime, &org);
    f.app.attach_engine(
        f.store.clone(),
        vec![("scripted".into(), runtime as Arc<dyn AgentRuntime>)],
        "scripted",
        None,
    );

    let catalog = admin.get("/engine/catalog").await;
    assert_eq!(catalog.status, 200);
    assert!(catalog.body["tools"]
        .to_string()
        .contains("financeiro.consultar_pagamento"));

    let started = admin
        .post(
            "/engine/activities",
            json!({"agent_id": org.lu, "request": "O cliente ACME pagou?", "idempotency_key": "k1"}),
        )
        .await;
    assert_eq!(started.status, 201, "{:?}", started.body);
    let id = started.body["id"].as_i64().unwrap();
    let mut detail = Value::Null;
    for _ in 0..200 {
        detail = admin.get(&format!("/engine/activities/{id}")).await.body;
        if detail["activity"]["status"] == "completed" {
            break;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    assert_eq!(detail["activity"]["status"], "completed", "{detail}");
    assert_eq!(detail["delegations"].as_array().unwrap().len(), 1);
    assert_eq!(admin.get("/engine/activities").await.body.as_array().unwrap().len(), 2);

    // Policy and grants: validated, audited, deny by default.
    let policy = admin.get(&format!("/engine/agents/{}/policy", org.anny)).await.body;
    assert_eq!(policy["policy"]["proactive_enabled"], false);
    assert_eq!(policy["grants"][0]["tool"], "financeiro.consultar_pagamento");
    let bad = json!({"enabled": true, "proactive_enabled": false, "execution_policy": "yolo",
        "max_concurrency": 1, "run_timeout_secs": 60, "monthly_token_budget": null});
    assert_eq!(
        admin
            .put(&format!("/engine/agents/{}/policy", org.anny), bad)
            .await
            .status,
        400
    );
    let grant = json!({"tool": "financeiro.registrar_cobranca", "effect": "approval"});
    let granted = admin.put(&format!("/engine/agents/{}/grants", org.anny), grant).await;
    assert_eq!(granted.status, 200, "{:?}", granted.body);
    assert_eq!(granted.body["grants"].as_array().unwrap().len(), 2);

    // People who are not administrators see nothing.
    let agent = f.agent(&admin, "ana@padaria.com", "agent", false).await;
    assert_eq!(agent.get("/engine/activities").await.status, 403);
}

#[tokio::test]
async fn runtimes_reach_tools_only_with_a_live_run_token() {
    let f = Fixture::new().await;
    f.bootstrap().await;
    let org = seed(&f.store, 1);
    let engine = f.app.attach_engine(f.store.clone(), vec![], "scripted", None);
    let (activity, _) = engine
        .submit(&wamcp_server::application::engine::Submission {
            account_id: 1,
            agent_id: org.anny,
            request: "Anote".into(),
            requester: "user:1".into(),
            ..Default::default()
        })
        .unwrap();
    f.store.move_activity(activity.id, "queued", "running", None).unwrap();
    let run = f.store.create_run(&activity, "opencode", None, "tok-live").unwrap();

    let hello = mcp(
        &f,
        "tok-live",
        json!({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-06-18"}}),
        false,
    )
    .await;
    assert_eq!(hello.body["result"]["serverInfo"]["name"], "wamcp-engine");
    let list = mcp(
        &f,
        "tok-live",
        json!({"jsonrpc": "2.0", "id": 2, "method": "tools/list"}),
        false,
    )
    .await;
    let names: Vec<&str> = list.body["result"]["tools"]
        .as_array()
        .unwrap()
        .iter()
        .map(|t| t["name"].as_str().unwrap())
        .collect();
    assert!(names.contains(&"financeiro__consultar_pagamento"), "{names:?}");
    assert!(
        !names.contains(&"financeiro__registrar_cobranca"),
        "a tool without grant is not offered"
    );
    let call = json!({"jsonrpc": "2.0", "id": 3, "method": "tools/call",
        "params": {"name": "financeiro__consultar_pagamento", "arguments": {"cliente": "ACME"}}});
    let paid = mcp(&f, "tok-live", call.clone(), false).await;
    assert_eq!(paid.body["result"]["isError"], false, "{:?}", paid.body);
    assert_eq!(paid.body["result"]["structuredContent"]["resultado"]["status"], "pago");

    assert_eq!(mcp(&f, "tok-errado", call.clone(), false).await.status, 401);
    assert_eq!(mcp(&f, "tok-live", call.clone(), true).await.status, 403);
    f.store.finish_run(run.id, "completed", None).unwrap();
    assert_eq!(
        mcp(&f, "tok-live", call, false).await.status,
        401,
        "a finished run's token is dead"
    );
}
