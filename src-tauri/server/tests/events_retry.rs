//! MCP events delivery policy (port of tests/events-service-retry.test.mjs): retries with backoff,
//! TTL caps, queue/owner limits, bounded concurrency, shutdown and refresh of queued expiry.
mod events_support;

use events_support::{delivery, incoming, owner, params, settle, until, Env, JID};
use serde_json::json;
use std::collections::HashSet;
use std::sync::atomic::Ordering;
use wamcp_server::domain::events::EVENT_TTL;
use wamcp_server::domain::model::WaMessage;

#[tokio::test]
async fn delivery_response_policy_retries_only_transient_failures_with_bounded_attempts() {
    for status in [204_u16, 400, 401, 403, 404, 410, 413, 429, 500, 503, 0] {
        let f = Env::new();
        *f.callback.status.lock() = status;
        f.service
            .subscribe(owner("one", "reader"), &params(json!({})))
            .await
            .expect("subscribe");
        f.service.publish("one", &incoming("message"));
        f.service.flush().await;
        let transient = [0, 429, 500, 503].contains(&status);
        assert_eq!(f.pending(), i64::from(transient), "status {status}");
        assert_eq!(f.list(None).len(), if status == 410 { 0 } else { 1 }, "status {status}");
        let (attempt, recorded, outcome) = f.diagnostics("one")[0].clone();
        assert_eq!(attempt, 1);
        assert_eq!(recorded, i64::from(status));
        let expected = match status {
            204 => "delivered",
            410 => "disabled",
            _ if transient => "retry",
            _ => "discarded",
        };
        assert_eq!(outcome, expected, "status {status}");
        f.service.flush().await;
        assert_eq!(f.callback.delivered().len(), 1);
        if transient {
            for attempt in 1..8 {
                f.advance(1000 * 2_i64.pow(attempt - 1));
                f.service.flush().await;
            }
            assert_eq!(f.callback.delivered().len(), 8);
            assert_eq!(f.pending(), 0);
            let last = f.diagnostics("one")[0].clone();
            assert_eq!((last.0, last.2.as_str()), (8, "discarded"));
            let ids: HashSet<String> = f
                .callback
                .delivered()
                .iter()
                .map(|d| d.event["eventId"].to_string())
                .collect();
            assert_eq!(ids.len(), 1);
        }
    }
}

#[tokio::test]
async fn subscription_ttl_is_finite_and_capped_and_expired_queued_data_is_not_revived_by_refresh() {
    let f = Env::new();
    let reader = || owner("one", "reader");
    let long = f
        .service
        .subscribe(reader(), &params(json!({ "ttlMs": EVENT_TTL * 10 })))
        .await
        .expect("long");
    let finite = f
        .service
        .subscribe(reader(), &params(json!({ "ttlMs": null })))
        .await
        .expect("finite");
    assert_eq!(long["refreshBefore"], finite["refreshBefore"]);
    assert!(finite["refreshBefore"].is_string());
    f.service.publish("one", &incoming("message"));
    f.advance(EVENT_TTL);
    f.service
        .subscribe(reader(), &params(json!({})))
        .await
        .expect("refresh");
    f.service.flush().await;
    assert_eq!(f.pending(), 0);
    assert_eq!(f.callback.delivered().len(), 0);
}

async fn fill_owner_quota(f: &Env) {
    for index in 1..50 {
        let url = format!("https://receiver.example/{index}");
        let extra = json!({ "delivery": delivery(&url, &events_support::secret(1)) });
        f.service
            .subscribe(owner("one", "reader"), &params(extra))
            .await
            .expect("within quota");
    }
}

#[tokio::test]
async fn queue_and_owner_limits_are_bounded_and_overflow_has_sanitized_diagnostics() {
    let f = Env::new();
    f.service
        .subscribe(owner("one", "reader"), &params(json!({})))
        .await
        .expect("subscribe");
    for index in 0..1000 {
        assert_eq!(f.service.publish("one", &incoming(&format!("id{index}"))), 1);
    }
    assert_eq!(f.service.publish("one", &incoming("overflow")), 0);
    assert_eq!(f.pending(), 1000);
    let (attempt, _, outcome) = f.diagnostics("one")[0].clone();
    assert_eq!(outcome, "queue_full");
    assert_eq!(attempt, 0);
    let stored = f.raw_attempts();
    for leak in ["whsec", "receiver.example", "Alice", "Hello"] {
        assert!(!stored.contains(leak), "{leak} leaked into diagnostics");
    }
    assert!(f.diagnostics("two").is_empty());
    fill_owner_quota(&f).await;
    let extra = json!({ "delivery": delivery("https://receiver.example/overflow", &events_support::secret(1)) });
    assert!(f
        .service
        .subscribe(owner("one", "reader"), &params(extra))
        .await
        .is_err());
    assert_eq!(f.list(None).len(), 50);
}

#[tokio::test]
async fn owner_limit_rejection_names_the_limit() {
    let f = Env::new();
    f.service
        .subscribe(owner("one", "reader"), &params(json!({})))
        .await
        .expect("subscribe");
    fill_owner_quota(&f).await;
    let extra = json!({ "delivery": delivery("https://receiver.example/overflow", &events_support::secret(1)) });
    let error = f
        .service
        .subscribe(owner("one", "reader"), &params(extra))
        .await
        .expect_err("limit");
    assert!(error.message.contains("Limite"), "{}", error.message);
}

#[tokio::test]
async fn concurrent_flushes_share_a_batch_and_callbacks_progress_with_bounded_concurrency() {
    let f = Env::new();
    let gate = f.callback.block_deliver();
    for index in 0..6 {
        f.service
            .subscribe(owner("one", &format!("reader{index}")), &params(json!({})))
            .await
            .expect("subscribe");
    }
    f.service.publish("one", &incoming("message"));
    let (one, two) = (f.service.clone(), f.service.clone());
    let flush = tokio::spawn(async move { one.flush().await });
    let concurrent = tokio::spawn(async move { two.flush().await });
    until(|| f.callback.active.load(Ordering::SeqCst) == 4).await;
    settle().await;
    assert_eq!(f.callback.active.load(Ordering::SeqCst), 4);
    gate.add_permits(4);
    until(|| f.callback.active.load(Ordering::SeqCst) == 2).await;
    gate.add_permits(2);
    flush.await.expect("flush");
    concurrent.await.expect("concurrent flush");
    assert_eq!(f.callback.max_active.load(Ordering::SeqCst), 4);
    assert_eq!(f.callback.delivered().len(), 6);
}

#[tokio::test]
async fn shutdown_preserves_unsent_queue_and_rejects_new_work() {
    let f = Env::new();
    let gate = f.callback.block_deliver();
    f.service
        .subscribe(owner("one", "reader"), &params(json!({})))
        .await
        .expect("subscribe");
    for index in 0..5 {
        f.service.publish("one", &incoming(&format!("id{index}")));
    }
    let service = f.service.clone();
    let flush = tokio::spawn(async move { service.flush().await });
    until(|| f.callback.active.load(Ordering::SeqCst) == 1).await;
    // Node's close() also awaits the in-flight delivery; Rust's close() is synchronous.
    f.service.close();
    assert_eq!(f.service.publish("one", &incoming("later")), 0);
    gate.add_permits(1);
    flush.await.expect("flush");
    assert_eq!(f.callback.delivered().len(), 1);
    assert_eq!(f.pending(), 4);
    let error = f
        .service
        .subscribe(owner("one", "reader"), &params(json!({})))
        .await
        .expect_err("closed");
    assert_eq!(error.code, -32001);
}

#[tokio::test]
async fn active_refresh_atomically_extends_queued_delivery_beyond_the_original_expiry() {
    let f = Env::new();
    let reader = || owner("one", "reader");
    let original = f
        .service
        .subscribe(reader(), &params(json!({ "ttlMs": 10000 })))
        .await
        .expect("original");
    f.service.publish("one", &incoming("message"));
    f.advance(9000);
    let refreshed = f
        .service
        .subscribe(reader(), &params(json!({ "ttlMs": 10000 })))
        .await
        .expect("refresh");
    assert_eq!(refreshed["id"], original["id"]);
    let expiry = f
        .store
        .scalar("SELECT expires FROM event_queue", vec![])
        .expect("query")
        .expect("row");
    let refresh_before = refreshed["refreshBefore"].as_str().expect("iso");
    let parsed = chrono::DateTime::parse_from_rfc3339(refresh_before)
        .expect("date")
        .timestamp_millis();
    assert_eq!(expiry, parsed);
    f.advance(2000);
    f.service.flush().await;
    assert_eq!(f.callback.delivered().len(), 1);
    assert_eq!(f.pending(), 0);
}

#[tokio::test]
async fn a_slow_subscription_backlog_occupies_at_most_one_callback_in_each_batch() {
    let f = Env::new();
    let gate = f.callback.block_deliver();
    let slow = f
        .service
        .subscribe(owner("one", "reader"), &params(json!({ "arguments": { "jid": JID } })))
        .await;
    let slow = slow.expect("slow")["id"].as_str().expect("id").to_string();
    *f.callback.gated.lock() = Some(HashSet::from([slow.clone()]));
    for index in 0..100 {
        f.service.publish("one", &incoming(&format!("slow{index}")));
    }
    let service = f.service.clone();
    let first = tokio::spawn(async move { service.flush().await });
    until(|| f.callback.active.load(Ordering::SeqCst) == 1).await;
    let fast_jid = "5511888888888@s.whatsapp.net";
    let fast = params(json!({ "arguments": { "jid": fast_jid } }));
    f.service.subscribe(owner("one", "fast"), &fast).await.expect("fast");
    f.service.publish(
        "one",
        &WaMessage {
            jid: fast_jid.into(),
            ..incoming("fast")
        },
    );
    gate.add_permits(1);
    first.await.expect("first");
    assert_eq!(f.callback.delivered().len(), 1);
    let service = f.service.clone();
    let second = tokio::spawn(async move { service.flush().await });
    until(|| f.callback.active.load(Ordering::SeqCst) == 1).await;
    until(|| f.callback.delivered().iter().any(|d| d.subscription != slow)).await;
    gate.add_permits(1);
    second.await.expect("second");
    assert_eq!(
        f.callback.delivered().iter().filter(|d| d.subscription == slow).count(),
        2
    );
}
