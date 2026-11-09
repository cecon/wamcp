//! The chain of a request closes: the person who asked hears how it ended in their chat with the
//! agent, and so do the copies they added, once per state (waiting for an approval, then the result).
use crate::engine_support;

use engine_support::{engine, seed, standard, RecordingChannel, ScriptedRuntime};
use std::sync::Arc;
use std::time::Duration;
use wamcp_server::adapters::outbound::sqlite::SqliteStore;
use wamcp_server::application::engine::{EngineService, Submission};
use wamcp_server::application::ports::EngineRepo;

fn ask(org: &engine_support::Org, copies: Vec<(&str, i64)>) -> Submission {
    Submission {
        account_id: org.account,
        agent_id: org.lu,
        request: "Lu, o cliente ACME pagou?".into(),
        requester: "user:1".into(),
        copies: copies.into_iter().map(|(k, id)| (k.to_string(), id)).collect(),
        ..Submission::default()
    }
}

async fn deliveries_until(channel: &RecordingChannel, count: usize) -> Vec<(String, i64, String)> {
    for _ in 0..250 {
        let list = channel.deliveries.lock().clone();
        if list.len() >= count {
            return list.into_iter().map(|d| (d.kind, d.target_id, d.text)).collect();
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    panic!("only {} deliveries", channel.deliveries.lock().len());
}

fn setup() -> (
    Arc<SqliteStore>,
    engine_support::Org,
    Arc<RecordingChannel>,
    EngineService,
) {
    let store = Arc::new(SqliteStore::in_memory().unwrap());
    let org = seed(&store, 1);
    let (runtime, channel) = (
        Arc::new(ScriptedRuntime::default()),
        Arc::new(RecordingChannel::default()),
    );
    standard(&runtime, &org);
    let engine = engine(store.clone(), runtime, channel.clone());
    (store, org, channel, engine)
}

#[tokio::test]
async fn the_answer_returns_to_who_asked_and_to_the_copies() {
    let (_store, org, channel, engine) = setup();
    let (root, _) = engine
        .submit(&ask(&org, vec![("user", 2), ("contact", 9), ("contact", 404)]))
        .unwrap();
    let done = engine.execute(1, root.id).await.unwrap();
    assert_eq!(done.status, "completed", "{:?}", done.error);

    let list = deliveries_until(&channel, 3).await;
    assert_eq!(list.len(), 3, "{list:?}");
    let (kind, id, text) = &list[0];
    assert_eq!((kind.as_str(), *id), ("user", 1));
    assert!(
        text.starts_with(&format!("Pedido #{} concluído por Lu1.", root.id)),
        "{text}"
    );
    assert!(
        text.contains("Pedido: Lu, o cliente ACME pagou?") && text.contains("pago"),
        "{text}"
    );
    assert!(list[1].2.starts_with("Cópia do pedido") && list[2].0 == "contact");
    // Nothing went to a conversation: nobody asked from one.
    assert!(channel.replies.lock().is_empty());

    // Each one hears once; the failed delivery stays on the recipient for the request's screen.
    engine.notify_recipients(1, root.id).await.unwrap();
    assert_eq!(channel.deliveries.lock().len(), 3);
    let detail = engine.detail(1, root.id).unwrap();
    let recipients = detail["recipients"].as_array().unwrap();
    assert_eq!(recipients.len(), 4);
    assert_eq!(recipients[0]["copy"], false);
    assert!(recipients.iter().all(|r| r["last_event"] == "completed"));
    let failed = recipients.iter().find(|r| r["target_id"] == 404).unwrap();
    assert!(failed["error"].as_str().unwrap().contains("WhatsApp"));
}

#[tokio::test]
async fn a_wait_for_approval_is_told_once_and_the_result_follows() {
    let (store, org, channel, engine) = setup();
    store
        .set_grant(1, org.anny, "financeiro.consultar_pagamento", Some("approval"))
        .unwrap();
    let (root, _) = engine.submit(&ask(&org, vec![])).unwrap();
    assert_eq!(engine.execute(1, root.id).await.unwrap().status, "waiting_approval");
    let waiting = deliveries_until(&channel, 1).await;
    assert!(waiting[0].2.contains("espera uma aprovação"), "{waiting:?}");
    // Running it again while it waits says nothing new.
    engine.execute(1, root.id).await.unwrap();
    assert_eq!(channel.deliveries.lock().len(), 1);

    let detail = engine.detail(1, root.id).unwrap();
    let call = detail["tree"][1]["tool_calls"][0]["id"].as_i64().unwrap();
    engine.decide(1, call, true, 1).await.unwrap();
    let list = deliveries_until(&channel, 2).await;
    assert!(
        list[1].2.contains("concluído por Lu1") && list[1].2.contains("pago"),
        "{list:?}"
    );
}

#[tokio::test]
async fn a_cancelled_request_is_told_and_bad_copies_are_refused() {
    let (store, org, channel, engine) = setup();
    store
        .set_grant(1, org.anny, "financeiro.consultar_pagamento", Some("approval"))
        .unwrap();
    let (root, _) = engine.submit(&ask(&org, vec![])).unwrap();
    engine.execute(1, root.id).await.unwrap();
    engine.cancel(1, root.id).await.unwrap();
    let list = deliveries_until(&channel, 2).await;
    assert!(list[1].2.contains("foi cancelado"), "{list:?}");

    let bad = ask(&org, vec![("agent", 3)]);
    assert!(engine.submit(&bad).is_err());
    let many = ask(&org, (0..11).map(|n| ("user", n)).collect());
    assert!(engine.submit(&many).is_err());
    // A refused request leaves nothing behind.
    assert_eq!(store.activities(1, 100).unwrap().len(), 2);
}
