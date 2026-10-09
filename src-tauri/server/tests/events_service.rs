//! MCP events service (port of tests/events-service.test.mjs): validation, deterministic
//! subscriptions, verification cache, secret rotation, filtering, durability and revocation.
mod events_support;

use events_support::{delivery, incoming, owner, params, secret, until, Env, JID, OTHER_JID};
use serde_json::{json, Value};
use std::sync::atomic::Ordering;
use wamcp_server::domain::events::{EVENT_TTL, ROTATION_WINDOW};
use wamcp_server::domain::model::WaMessage;

fn millis(iso: &Value) -> i64 {
    let text = iso.as_str().expect("refreshBefore");
    chrono::DateTime::parse_from_rfc3339(text)
        .expect("iso date")
        .timestamp_millis()
}

#[tokio::test]
async fn events_catalog_and_strict_bounded_subscription_validation() {
    let f = Env::new();
    assert_eq!(f.service.list()["events"][0]["name"], "message.created");
    let valid = secret(1);
    let invalid = [
        json!({ "name": "other" }),
        json!({ "arguments": null }),
        json!({ "arguments": { "sessionId": "two" } }),
        json!({ "arguments": { "jid": "status@broadcast" } }),
        json!({ "cursor": "replay" }),
        json!({ "ttlMs": 0 }),
        json!({ "ttlMs": -1 }),
        json!({ "ttlMs": 1.5 }),
        json!({ "delivery": { "mode": "polling" } }),
        json!({ "delivery": delivery("http://receiver.example", &valid) }),
        json!({ "delivery": delivery("https://user:password@receiver.example", &valid) }),
        json!({ "delivery": delivery("https://receiver.example", "whsec_AA==") }),
    ];
    for value in invalid {
        let error = f
            .service
            .subscribe(owner("one", "reader"), &params(value.clone()))
            .await
            .expect_err("invalid");
        assert_eq!(error.code, -32602, "{value}");
    }
    assert_eq!(f.callback.verified.lock().len(), 0);
    let mut unknown = owner("one", "reader");
    unknown.principal_kind = "unknown".into();
    assert_eq!(
        f.service
            .subscribe(unknown, &params(json!({})))
            .await
            .expect_err("owner")
            .code,
        -32001
    );
}

#[tokio::test]
async fn deterministic_subscriptions_refresh_expiry_cache_verification_and_rotate_secrets() {
    let f = Env::new();
    let reader = || owner("one", "reader");
    let first = f
        .service
        .subscribe(reader(), &params(json!({ "ttlMs": 5000 })))
        .await
        .expect("first");
    let same = f
        .service
        .subscribe(reader(), &params(json!({ "ttlMs": null })))
        .await
        .expect("same");
    assert_eq!(first["id"], same["id"]);
    assert_eq!(
        millis(&same["refreshBefore"]) - millis(&first["refreshBefore"]),
        EVENT_TTL - 5000
    );
    assert_eq!(f.callback.verified.lock().len(), 1);
    let rotated = params(json!({ "delivery": delivery("https://receiver.example/events", &secret(2)) }));
    f.service.subscribe(reader(), &rotated).await.expect("rotated");
    assert_eq!(f.callback.verified.lock().len(), 2);
    let id = first["id"].as_str().expect("id");
    let stored = f.get(id).expect("stored");
    assert_eq!(stored.previous_secret.as_deref(), Some(secret(1).as_str()));
    assert_eq!(stored.secret, secret(2));
    f.service.publish("one", &incoming("message"));
    f.service.flush().await;
    assert_eq!(f.callback.delivered()[0].secrets, vec![secret(2), secret(1)]);
    f.advance(ROTATION_WINDOW + 1);
    f.service.flush().await;
    assert_eq!(f.get(id).expect("stored").previous_secret, None);
    f.service.subscribe(reader(), &rotated).await.expect("again");
    assert_eq!(f.callback.verified.lock().len(), 3);
}

#[tokio::test]
async fn rotation_signs_with_both_secrets_only_until_the_millisecond_deadline() {
    let f = Env::new();
    f.service
        .subscribe(owner("one", "reader"), &params(json!({})))
        .await
        .expect("first");
    let rotated = params(json!({ "delivery": delivery("https://receiver.example/events", &secret(2)) }));
    let rotation = f.now();
    f.service
        .subscribe(owner("one", "reader"), &rotated)
        .await
        .expect("rotated");
    f.clock.set(rotation + ROTATION_WINDOW - 1);
    f.service.publish("one", &incoming("before"));
    f.service.flush().await;
    f.clock.set(rotation + ROTATION_WINDOW);
    f.service.publish("one", &incoming("after"));
    f.service.flush().await;
    let delivered = f.callback.delivered();
    assert_eq!(delivered[0].secrets.len(), 2);
    assert_eq!(delivered[1].secrets, vec![secret(2)]);
}

#[tokio::test]
async fn filtering_owner_session_isolation_outgoing_suppression_and_truncation() {
    let f = Env::new();
    f.service
        .subscribe(owner("one", "reader"), &params(json!({ "arguments": { "jid": JID } })))
        .await
        .expect("a");
    f.service
        .subscribe(owner("two", "reader"), &params(json!({})))
        .await
        .expect("b");
    let other = params(json!({ "arguments": { "jid": OTHER_JID } }));
    f.service.subscribe(owner("one", "other"), &other).await.expect("c");
    assert_eq!(
        f.service.publish(
            "one",
            &WaMessage {
                from_me: true,
                ..incoming("sent")
            }
        ),
        0
    );
    // Node also rejects a message with an unknown origin (`from_me: undefined`); Rust's bool cannot express it.
    assert_eq!(
        f.service.publish(
            "one",
            &WaMessage {
                jid: "status@broadcast".into(),
                ..incoming("status")
            }
        ),
        0
    );
    assert_eq!(
        f.service.publish(
            "one",
            &WaMessage {
                body: "a".repeat(10_000),
                ..incoming("long")
            }
        ),
        1
    );
    f.service.flush().await;
    let delivered = f.callback.delivered();
    let subscription = f.get(&delivered[0].subscription).expect("subscription");
    assert_eq!(subscription.session_id, "one");
    assert_eq!(subscription.principal_id, "reader");
    let event = &delivered[0].event;
    assert_eq!(event["data"]["text"].as_str().map(|t| t.chars().count()), Some(8000));
    assert_eq!(event["data"]["truncated"], true);
    assert_eq!(event["timestamp"], "1970-01-01T00:01:40.000Z");
    assert_eq!(event["cursor"], Value::Null);
    assert_eq!(delivered.len(), 1);
    let filtered = params(json!({ "arguments": { "jid": JID } }));
    f.service
        .unsubscribe(owner("one", "other"), &filtered)
        .await
        .expect("foreign");
    assert_eq!(f.list(Some("one")).len(), 2);
    f.service
        .unsubscribe(owner("one", "reader"), &filtered)
        .await
        .expect("own");
    f.service
        .unsubscribe(owner("one", "reader"), &filtered)
        .await
        .expect("idempotent");
    assert_eq!(f.list(Some("one")).len(), 1);
}

#[tokio::test]
async fn subscriptions_pending_delivery_stable_event_ids_and_receipts_survive_restart() {
    let mut f = Env::new();
    *f.callback.status.lock() = 503;
    let subscription = f
        .service
        .subscribe(owner("one", "reader"), &params(json!({})))
        .await
        .expect("subscribe");
    let id = subscription["id"].as_str().expect("id").to_string();
    assert_eq!(f.service.publish("one", &incoming("message")), 1);
    assert_eq!(f.service.publish("one", &incoming("message")), 0);
    f.service.flush().await;
    let event_id = f.callback.delivered()[0].event["eventId"].clone();
    assert_eq!(f.pending(), 1);
    f.reopen();
    assert_eq!(f.get(&id).expect("persisted").secret, secret(1));
    *f.callback.status.lock() = 204;
    f.advance(1000);
    f.service.flush().await;
    assert_eq!(f.callback.delivered()[1].event["eventId"], event_id);
    assert_eq!(f.pending(), 0);
    f.reopen();
    assert_eq!(f.service.publish("one", &incoming("message")), 0);
}

#[tokio::test]
async fn expiration_revocation_and_disconnect_purge_subscriptions_and_queued_payloads() {
    let f = Env::new();
    let reader = || owner("one", "reader");
    f.service
        .subscribe(reader(), &params(json!({ "ttlMs": 10 })))
        .await
        .expect("short");
    f.service.publish("one", &incoming("message"));
    f.advance(10);
    f.service.flush().await;
    assert_eq!(f.pending(), 0);
    assert_eq!(f.list(None).len(), 0);
    f.service.subscribe(reader(), &params(json!({}))).await.expect("again");
    f.service.publish("one", &incoming("message"));
    f.revoke("one", "reader");
    f.service.flush().await;
    assert_eq!(f.pending(), 0);
    assert_eq!(f.list(None).len(), 0);
    assert_eq!(f.callback.delivered().len(), 0);
    f.revoked.lock().clear();
    f.service.subscribe(reader(), &params(json!({}))).await.expect("third");
    f.service.publish("one", &incoming("message"));
    f.service.disconnect("one").expect("disconnect");
    assert_eq!(f.pending(), 0);
    assert_eq!(f.list(None).len(), 0);
}

#[tokio::test]
async fn verification_failure_does_not_activate_subscription_or_expose_callback_details() {
    let f = Env::new();
    *f.callback.verify_error.lock() = Some("secret provider detail".into());
    let error = f
        .service
        .subscribe(owner("one", "reader"), &params(json!({})))
        .await
        .expect_err("fails");
    assert_eq!(error.code, -32015);
    assert_eq!(error.reason.as_deref(), Some("challenge_failed"));
    assert!(!error.message.contains("secret provider detail"));
    assert_eq!(f.list(None).len(), 0);
}

#[tokio::test]
async fn revocation_and_disconnect_during_verification_cannot_activate_a_subscription() {
    for action in ["revoke", "disconnect"] {
        let f = Env::new();
        let gate = f.callback.block_verify();
        let service = f.service.clone();
        let pending = tokio::spawn(async move { service.subscribe(owner("one", "reader"), &params(json!({}))).await });
        until(|| f.callback.verifying.load(Ordering::SeqCst) == 1).await;
        if action == "revoke" {
            f.revoke("one", "reader");
        } else {
            f.service.disconnect("one").expect("disconnect");
        }
        gate.add_permits(1);
        let error = pending.await.expect("task").expect_err(action);
        assert_eq!(error.code, -32001, "{action}");
        assert_eq!(f.list(None).len(), 0, "{action}");
    }
}

#[tokio::test]
async fn unsubscribe_is_serialized_behind_concurrent_verification_and_remains_idempotent() {
    let f = Env::new();
    let gate = f.callback.block_verify();
    let service = f.service.clone();
    let pending = tokio::spawn(async move { service.subscribe(owner("one", "reader"), &params(json!({}))).await });
    until(|| f.callback.verifying.load(Ordering::SeqCst) == 1).await;
    let service = f.service.clone();
    let removal = tokio::spawn(async move { service.unsubscribe(owner("one", "reader"), &params(json!({}))).await });
    events_support::settle().await;
    gate.add_permits(1);
    pending.await.expect("task").expect("subscribed");
    assert_eq!(removal.await.expect("task").expect("removed"), json!({}));
    assert_eq!(f.list(None).len(), 0);
}
