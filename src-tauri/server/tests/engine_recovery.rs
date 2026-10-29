//! Restart during an activity: a second process over the same database recovers the unfinished
//! work without losing it and without repeating external effects (the finance call ran once, the
//! answer went out once). An answer that may already have gone out is never re-sent.
mod engine_support;

use engine_support::{anny_script, engine, seed, standard, Outcome, RecordingChannel, ScriptedRuntime, Turn};
use serde_json::json;
use std::sync::Arc;
use std::time::Duration;
use wamcp_server::adapters::outbound::sqlite::SqliteStore;
use wamcp_server::application::engine::{EngineService, Submission};
use wamcp_server::application::ports::EngineRepo;

fn ask(lu: i64, request: &str) -> Submission {
    Submission {
        account_id: 1,
        agent_id: lu,
        request: request.into(),
        requester: "contact:3".into(),
        conversation_id: Some(77),
        ..Submission::default()
    }
}

async fn until(engine: &EngineService, id: i64, wanted: &str) {
    for _ in 0..300 {
        if engine.detail(1, id).unwrap()["activity"]["status"] == wanted {
            return;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    panic!("activity {id} never became {wanted}: {}", engine.detail(1, id).unwrap());
}

fn count(store: &SqliteStore, sql: &str) -> i64 {
    store.scalar(sql, vec![]).unwrap().unwrap_or(0)
}

#[tokio::test]
async fn a_restart_mid_activity_resumes_without_duplicate_effects() {
    let dir = tempfile::tempdir().unwrap();
    let first = Arc::new(SqliteStore::open(dir.path()).unwrap());
    let org = seed(&first, 1);
    // First process: Anny gets the payment and then the process "dies" before she concludes.
    let runtime = Arc::new(ScriptedRuntime::default());
    standard(&runtime, &org);
    runtime.script(
        "Anny1",
        Arc::new(|turn: Turn| {
            Box::pin(async move {
                turn.call("financeiro.consultar_pagamento", json!({"cliente": "ACME"}))
                    .await;
                Outcome::Hang
            })
        }),
    );
    let channel_before = Arc::new(RecordingChannel::default());
    let before = engine(first.clone(), runtime, channel_before.clone());
    let (root, _) = before.submit(&ask(org.lu, "O cliente ACME pagou?")).unwrap();
    let background = before.clone();
    let doomed = tokio::spawn(async move { background.execute(1, root.id).await });
    for _ in 0..300 {
        if count(&first, "SELECT COUNT(*) FROM engine_tool_calls WHERE status='ok'") == 1 {
            break;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    doomed.abort();

    // Second process over the same database file, with Anny working normally again.
    let second = Arc::new(SqliteStore::open(dir.path()).unwrap());
    let runtime = Arc::new(ScriptedRuntime::default());
    standard(&runtime, &org);
    runtime.script("Anny1", anny_script());
    let channel = Arc::new(RecordingChannel::default());
    let after = engine(second.clone(), runtime.clone(), channel.clone());
    assert_eq!(after.recover().await.unwrap(), 1);
    until(&after, root.id, "completed").await;

    let done = second.activity(1, root.id).unwrap().unwrap();
    assert!(done.result.unwrap().contains("pago"));
    // The finance system was called once; the resumed Anny got the stored result and evidence.
    assert_eq!(count(&second, "SELECT COUNT(*) FROM engine_tool_calls"), 1);
    assert_eq!(count(&second, "SELECT COUNT(*) FROM engine_evidence"), 1);
    assert_eq!(
        count(
            &second,
            "SELECT COUNT(*) FROM engine_audit WHERE action='tool.call' AND outcome='allowed'"
        ),
        1
    );
    assert_eq!(count(&second, "SELECT COUNT(*) FROM engine_delegations"), 1);
    // Runs that were going when the process died are marked, not lost.
    assert!(count(&second, "SELECT COUNT(*) FROM engine_runs WHERE status='interrupted'") >= 2);
    assert_eq!(channel.replies.lock().len(), 1);
    assert!(channel_before.replies.lock().is_empty());
    assert_eq!(runtime.runs_of("Anny1"), 1);
}

#[tokio::test]
async fn an_answer_that_may_have_gone_out_is_not_sent_again() {
    let dir = tempfile::tempdir().unwrap();
    let store = Arc::new(SqliteStore::open(dir.path()).unwrap());
    let org = seed(&store, 1);
    let runtime = Arc::new(ScriptedRuntime::default());
    standard(&runtime, &org);
    let channel = Arc::new(RecordingChannel::default());
    let engine = engine(store.clone(), runtime.clone(), channel.clone());
    let (root, _) = engine.submit(&ask(org.lu, "O cliente ACME pagou?")).unwrap();
    // The process stopped between "sending" and "sent".
    store.move_activity(root.id, "queued", "running", None).unwrap();
    store.set_reply_state(root.id, Some("sending")).unwrap();

    engine.recover().await.unwrap();
    let failed = store.activity(1, root.id).unwrap().unwrap();
    assert_eq!(failed.status, "failed");
    assert!(failed.error.unwrap().contains("verifique se ela saiu"));
    assert!(channel.replies.lock().is_empty());
    assert_eq!(runtime.runs_of("Lu1"), 0);
}
