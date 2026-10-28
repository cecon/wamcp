//! Live check against the OpenCode installed on this computer (ignored by default: it starts real
//! processes and, with a key, calls a real model). Run with
//! `cargo test -p wamcp-server --no-default-features --test engine_opencode_live -- --ignored`.
//! With `WAMCP_ENGINE_LIVE_MODEL` (e.g. `openrouter/openai/gpt-4o-mini`) and `WAMCP_ENGINE_LIVE_KEY`
//! set, Lu and Anny run the whole flow on the real model; without them the run must fail cleanly
//! with the provider's error (process started, config isolated, MCP reachable, events followed).
mod common;
mod engine_support;

use common::Fixture;
use engine_support::seed;
use std::sync::Arc;
use std::time::Duration;
use wamcp_server::adapters::outbound::opencode::OpenCodeRuntime;
use wamcp_server::application::engine::Submission;
use wamcp_server::application::ports::{AgentRuntime, EngineRepo};

#[tokio::test]
#[ignore = "starts opencode serve; needs OpenCode installed"]
async fn opencode_runs_behind_the_engine() {
    let f = Fixture::new().await;
    f.bootstrap().await;
    let org = seed(&f.store, 1);
    let model = std::env::var("WAMCP_ENGINE_LIVE_MODEL").unwrap_or_else(|_| "openrouter/openai/gpt-4o-mini".into());
    let key = std::env::var("WAMCP_ENGINE_LIVE_KEY").ok();
    f.store
        .exec(
            "UPDATE agents SET runtime='opencode',model=?",
            vec![model.clone().into()],
        )
        .unwrap();
    if let Some(key) = &key {
        for agent in [org.lu, org.anny] {
            let sealed = f.app.state.support().agents.secrets.seal(key).unwrap();
            f.store
                .exec(
                    "INSERT INTO agent_credentials(agent_id,name,kind,secret,created) VALUES(?,'OPENROUTER_API_KEY','api_key',?,'x')",
                    vec![agent.into(), sealed.into()],
                )
                .unwrap();
        }
    }
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let router = f.app.public_router();
    tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
    let work = tempfile::tempdir().unwrap();
    let runtime = Arc::new(OpenCodeRuntime::new(work.path().to_path_buf()));
    assert_eq!(runtime.check(), Ok(()), "OpenCode not installed");
    let engine = f.app.attach_engine(
        f.store.clone(),
        vec![("opencode".into(), runtime as Arc<dyn AgentRuntime>)],
        "opencode",
        Some(format!("http://127.0.0.1:{port}/engine/mcp")),
    );
    let mut policy = f.store.policy(1, org.lu).unwrap();
    policy.run_timeout_secs = 120;
    f.store.save_policy(&policy).unwrap();
    let (root, _) = engine
        .submit(&Submission {
            account_id: 1,
            agent_id: org.lu,
            request: "Lu, o cliente ACME pagou?".into(),
            requester: "user:1".into(),
            ..Default::default()
        })
        .unwrap();
    let done = tokio::time::timeout(Duration::from_secs(600), engine.execute(1, root.id))
        .await
        .expect("engine timed out")
        .unwrap();
    let runs = f.store.runs(1, root.id).unwrap();
    println!("status={} result={:?} error={:?}", done.status, done.result, done.error);
    for run in &runs {
        println!(
            "run {} {} tokens={}/{} cost={:?} {:?}",
            run.attempt, run.status, run.input_tokens, run.output_tokens, run.cost_usd, run.error
        );
    }
    assert!(
        !runs.is_empty()
            && runs
                .iter()
                .all(|r| r.external_id.as_deref().is_some_and(|e| e.starts_with("ses")))
    );
    if key.is_some() {
        assert_eq!(done.status, "completed", "{:?}", done.error);
        assert!(!done.evidence.is_empty(), "the answer must cite Anny's evidence");
    } else {
        assert_eq!(done.status, "failed");
    }
    tokio::time::sleep(Duration::from_secs(1)).await;
    let left: Vec<_> = std::fs::read_dir(work.path()).unwrap().collect();
    assert!(left.is_empty(), "run folders must be removed after each run");
}

#[tokio::test]
#[ignore = "starts opencode serve; needs OpenCode installed"]
async fn opencode_answers_inboxes_through_the_llm_port() {
    use wamcp_server::adapters::outbound::opencode::OpenCodeLlm;
    use wamcp_server::application::ports::{Llm, LlmRequest};
    let work = tempfile::tempdir().unwrap();
    let llm = OpenCodeLlm::new(work.path().to_path_buf());
    assert!(llm.location().is_some(), "OpenCode not installed");
    let key = std::env::var("WAMCP_ENGINE_LIVE_KEY").ok();
    let request = LlmRequest {
        provider: "opencode".into(),
        model: Some(
            std::env::var("WAMCP_ENGINE_LIVE_MODEL").unwrap_or_else(|_| "openrouter/openai/gpt-4o-mini".into()),
        ),
        system: "Responda em JSON.".into(),
        prompt: "Diga olá.".into(),
        schema: serde_json::json!({"type": "object", "properties": {"reply": {"type": "string"}}, "required": ["reply"]}),
        api_key: key.clone(),
    };
    let started = std::time::Instant::now();
    let result = llm.complete(&request).await;
    println!("{result:?} in {:?}", started.elapsed());
    match key {
        Some(_) => assert!(result.unwrap().answer["reply"].is_string()),
        None => assert!(result.unwrap_err().to_string().starts_with("OpenCode")),
    }
    tokio::time::sleep(Duration::from_secs(1)).await;
    assert_eq!(
        std::fs::read_dir(work.path()).unwrap().count(),
        0,
        "call folders are removed"
    );
}
