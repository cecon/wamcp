//! The engine's MVP flow: Lu receives a request, finds in the directory that Anny has the payment
//! skill, delegates; Anny calls the (simulated) finance tool; Lu answers in the original channel
//! citing Anny's evidence. Activities, delegation, messages, audit and usage are all persisted.
mod engine_support;

use engine_support::{engine, seed, standard, RecordingChannel, ScriptedRuntime};
use serde_json::json;
use std::sync::Arc;
use wamcp_server::adapters::outbound::sqlite::SqliteStore;
use wamcp_server::application::engine::Submission;
use wamcp_server::application::ports::EngineRepo;

fn ask(org: &engine_support::Org, request: &str, key: Option<&str>) -> Submission {
    Submission {
        account_id: org.account,
        agent_id: org.lu,
        request: request.into(),
        requester: "contact:7".into(),
        conversation_id: Some(42),
        idempotency_key: key.map(String::from),
        ..Submission::default()
    }
}

#[tokio::test]
async fn lu_delegates_to_anny_and_answers_with_evidence() {
    let store = Arc::new(SqliteStore::in_memory().unwrap());
    let org = seed(&store, 1);
    let (runtime, channel) = (
        Arc::new(ScriptedRuntime::default()),
        Arc::new(RecordingChannel::default()),
    );
    standard(&runtime, &org);
    let engine = engine(store.clone(), runtime.clone(), channel.clone());

    let (root, created) = engine
        .submit(&ask(&org, "Lu, o cliente ACME pagou?", Some("wa:MSG1")))
        .unwrap();
    assert!(created);
    let done = engine.execute(org.account, root.id).await.unwrap();

    assert_eq!(done.status, "completed", "{:?}", done.error);
    let answer = done.result.clone().unwrap();
    assert!(answer.contains("pago") && answer.contains("1250"), "{answer}");
    assert_eq!(done.evidence.len(), 1);
    assert!(done.evidence[0].starts_with("ev_"));
    // The answer went out once, in the conversation the request came from.
    assert_eq!(channel.replies.lock().clone(), vec![(42, answer)]);

    let detail = engine.detail(org.account, root.id).unwrap();
    let delegation = &detail["delegations"][0];
    assert_eq!(delegation["from_agent_id"], json!(org.lu));
    assert_eq!(delegation["to_agent_id"], json!(org.anny));
    assert_eq!(delegation["hops"], 1);
    assert_eq!(delegation["correlation_id"], json!(root.correlation_id));
    let child = &detail["tree"][1];
    assert_eq!(child["activity"]["status"], "completed");
    assert_eq!(child["tool_calls"][0]["tool"], "financeiro.consultar_pagamento");
    assert_eq!(child["tool_calls"][0]["status"], "ok");
    assert_eq!(child["evidence"][0]["id"], json!(done.evidence[0]));
    // Request and answer between the agents.
    let messages = child["messages"].as_array().unwrap();
    assert_eq!(messages.len(), 2);
    assert_eq!(messages[0]["from_agent_id"], json!(org.lu));
    assert_eq!(messages[1]["from_agent_id"], json!(org.anny));

    let actions: Vec<String> = detail["audit"]
        .as_array()
        .unwrap()
        .iter()
        .map(|a| format!("{}:{}", a["action"].as_str().unwrap(), a["outcome"].as_str().unwrap()))
        .collect();
    for expected in [
        "activity.submit:created",
        "delegation.request:delegated",
        "tool.call:allowed",
        "activity.conclude:completed",
    ] {
        assert!(actions.contains(&expected.to_string()), "{expected} not in {actions:?}");
    }

    // Usage per run: tokens and an estimated cost (the scripted runtime reports none).
    let runs = store.runs(org.account, root.id).unwrap();
    assert_eq!(runs.len(), 1);
    assert_eq!((runs[0].input_tokens, runs[0].output_tokens), (1000, 200));
    assert_eq!(runs[0].cost_source.as_deref(), Some("estimated"));
    assert!(runs[0].cost_usd.unwrap() > 0.0);
    // The same usage feeds the members panel (salary), linked to the run.
    let linked = store
        .scalar(
            "SELECT COUNT(*) FROM llm_usage WHERE run_ref=? AND agent_id=? AND input_tokens=1000 AND cost_source='estimated'",
            vec![format!("engine_run:{}", runs[0].id).into(), org.lu.into()],
        )
        .unwrap();
    assert_eq!(linked, Some(1));

    // The same event again returns the same activity and runs nothing.
    let (again, created) = engine
        .submit(&ask(&org, "Lu, o cliente ACME pagou?", Some("wa:MSG1")))
        .unwrap();
    assert!(!created);
    assert_eq!(again.id, root.id);
    assert_eq!(runtime.runs_of("Lu1"), 1);
    assert_eq!(runtime.runs_of("Anny1"), 1);
}

#[tokio::test]
async fn lu_says_so_when_the_customer_does_not_exist() {
    let store = Arc::new(SqliteStore::in_memory().unwrap());
    let org = seed(&store, 1);
    let (runtime, channel) = (
        Arc::new(ScriptedRuntime::default()),
        Arc::new(RecordingChannel::default()),
    );
    standard(&runtime, &org);
    let engine = engine(store, runtime, channel);
    let (root, _) = engine.submit(&ask(&org, "O cliente Zeta pagou?", None)).unwrap();
    let done = engine.execute(org.account, root.id).await.unwrap();
    assert_eq!(done.status, "completed");
    assert!(done.result.unwrap().contains("nao_encontrado"));
    // Not found is still a verified answer, with its evidence.
    assert_eq!(done.evidence.len(), 1);
}
