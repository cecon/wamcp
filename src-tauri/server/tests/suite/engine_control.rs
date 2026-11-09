//! Live control of the engine: a paused agent's requests wait in the queue and run once it is
//! resumed, delegations to a paused agent are refused, and a cancelled request stops with
//! everything it delegated.
use crate::engine_support;

use engine_support::{engine, seed, standard, RecordingChannel, ScriptedRuntime};
use std::sync::Arc;
use std::time::Duration;
use wamcp_server::adapters::outbound::sqlite::SqliteStore;
use wamcp_server::application::engine::{EngineService, Submission};
use wamcp_server::application::ports::{EngineRepo, LiveRepo};

fn ask(agent: i64) -> Submission {
    Submission {
        account_id: 1,
        agent_id: agent,
        request: "O cliente ACME pagou?".into(),
        requester: "user:1".into(),
        ..Submission::default()
    }
}

async fn until(engine: &EngineService, id: i64, wanted: &str) {
    for _ in 0..200 {
        if engine.detail(1, id).unwrap()["activity"]["status"] == wanted {
            return;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    panic!("activity {id} never got to {wanted}");
}

fn setup() -> (
    Arc<SqliteStore>,
    engine_support::Org,
    Arc<ScriptedRuntime>,
    EngineService,
) {
    let store = Arc::new(SqliteStore::in_memory().unwrap());
    let org = seed(&store, 1);
    let runtime = Arc::new(ScriptedRuntime::default());
    standard(&runtime, &org);
    let engine = engine(store.clone(), runtime.clone(), Arc::new(RecordingChannel::default()));
    (store, org, runtime, engine)
}

#[tokio::test]
async fn a_paused_agent_keeps_its_requests_queued_until_resumed() {
    let (store, org, runtime, engine) = setup();
    store.set_agent_paused(org.lu, true).unwrap();
    let (root, _) = engine.submit(&ask(org.lu)).unwrap();
    let held = engine.execute(1, root.id).await.unwrap();
    assert_eq!(held.status, "queued");
    assert_eq!(runtime.runs_of("Lu"), 0);

    store.set_agent_paused(org.lu, false).unwrap();
    assert_eq!(engine.resume_agent(org.lu).unwrap(), 1);
    until(&engine, root.id, "completed").await;
}

#[tokio::test]
async fn delegating_to_a_paused_agent_is_refused_and_cancelling_stops_the_request() {
    let (store, org, _runtime, engine) = setup();
    store.set_agent_paused(org.anny, true).unwrap();
    let (root, _) = engine.submit(&ask(org.lu)).unwrap();
    engine.execute(1, root.id).await.unwrap();
    let detail = engine.detail(1, root.id).unwrap();
    assert_eq!(detail["delegations"].as_array().unwrap().len(), 0, "Anny got nothing");
    assert!(detail.to_string().contains("estão pausados"), "{detail}");

    let (other, _) = engine.submit(&ask(org.lu)).unwrap();
    let cancelled = engine.cancel(1, other.id).await.unwrap();
    assert_eq!(cancelled.status, "cancelled");
    assert!(engine.cancel(1, other.id).await.is_err(), "already over");
    let audit = engine.detail(1, other.id).unwrap()["audit"].to_string();
    assert!(audit.contains("activity.cancel"));
    assert_eq!(store.activity(1, other.id).unwrap().unwrap().status, "cancelled");
}
