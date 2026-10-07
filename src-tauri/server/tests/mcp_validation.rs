//! Port of `tests/mcp-events-protocol-validation.test.mjs`: authentication, JSON-RPC shape, the
//! per-request envelope, routing headers and event argument validation, all rejected before
//! dispatch. "No dispatch" is checked through the real side effects: no audit rows, no stored
//! subscriptions and no callback verification.
mod common;
mod mcp_support;

use axum::body::Body;
use common::http::send;
use mcp_support::{envelope, merge, subscription, Mcp, JID};
use serde_json::{json, Value};
use std::sync::Arc;
use wamcp_server::application::ports::{EventRepo, MirrorRepo};

fn nothing_dispatched(m: &Mcp) {
    assert_eq!(m.audit_count(), 0, "no tool or event operation ran");
    assert!(m.f.store.subscriptions(Some(&m.session.id)).unwrap().is_empty());
    assert!(m.f.callback.verified.lock().is_empty());
}

#[tokio::test]
async fn requests_need_session_bound_credentials_and_reject_browser_origins_and_other_verbs() {
    let m = Mcp::new().await;
    let methods = [
        "server/discover",
        "tools/list",
        "events/list",
        "events/subscribe",
        "events/unsubscribe",
    ];
    for method in methods {
        let denied = m.rpc(method, subscription(), "invalid", &[]).await;
        assert_eq!(denied.status, 401, "{method}");
        let challenge = denied.header("www-authenticate").unwrap_or_default();
        assert!(
            challenge.contains(&format!("oauth-protected-resource/mcp/{}", m.session.id)),
            "{challenge}"
        );
        let body = json!({ "jsonrpc": "2.0", "id": "request-1", "method": method,
            "params": merge(&json!({ "_meta": envelope() }), &subscription()) });
        let foreign = m.raw_to("session-b", Some(body), "reader", &[], "POST").await;
        assert_eq!(foreign.status, 401, "{method} on another session");
    }
    let origin = m
        .rpc(
            "server/discover",
            json!({}),
            "reader",
            &[("Origin", "https://example.org")],
        )
        .await;
    assert_eq!(origin.status, 403);
    for verb in ["GET", "DELETE"] {
        let other = m.raw(None, "reader", &[], verb).await;
        assert_eq!(other.status, 405, "{verb}");
        assert_eq!(other.header("allow").as_deref(), Some("POST"));
    }
    m.f.store.revoke(&m.session.id, &m.reader_id).unwrap();
    assert_eq!(m.rpc("events/list", json!({}), "reader", &[]).await.status, 401);
    nothing_dispatched(&m);
}

#[tokio::test]
async fn malformed_ids_params_requests_and_batches_are_rejected_without_dispatch() {
    let m = Mcp::new().await;
    let base = json!({ "jsonrpc": "2.0", "id": 1, "method": "events/list", "params": { "_meta": envelope() } });
    let with = |extra: Value| merge(&base, &extra);
    let cases = [
        Value::Null,
        json!(123),
        json!("invalid-request"),
        with(json!({ "jsonrpc": "1.0" })),
        with(json!({ "id": null })),
        with(json!({ "id": {} })),
        with(json!({ "id": [] })),
        with(json!({ "method": 123 })),
        with(json!({ "params": [] })),
        with(json!({ "params": null })),
        json!([base.clone()]),
    ];
    for body in cases {
        let result = m.raw(Some(body.clone()), "reader", &[], "POST").await;
        assert_eq!(result.status, 400, "{body}");
        let code = result.body["error"]["code"].as_i64().unwrap_or_default();
        assert!([-32600, -32602].contains(&code), "{body} -> {}", result.text);
    }
    assert_eq!(
        m.rpc("events/missing", json!({}), "reader", &[]).await.body["error"]["code"],
        -32601
    );
    nothing_dispatched(&m);
}

#[tokio::test]
async fn protocol_version_client_metadata_and_routing_headers_are_validated() {
    let m = Mcp::new().await;
    let metas = [
        json!({}),
        merge(&envelope(), &json!({ "io.modelcontextprotocol/protocolVersion": 123 })),
        merge(
            &envelope(),
            &json!({ "io.modelcontextprotocol/clientCapabilities": [] }),
        ),
        merge(&envelope(), &json!({ "io.modelcontextprotocol/clientInfo": "bad" })),
    ];
    for meta in metas {
        let malformed = m.rpc("events/list", json!({ "_meta": meta }), "reader", &[]).await;
        assert_eq!(malformed.status, 400, "{meta}");
        assert_eq!(malformed.body["error"]["code"], -32602, "{meta}");
    }
    let mismatch = m
        .rpc(
            "events/list",
            json!({}),
            "reader",
            &[("MCP-Protocol-Version", "2025-11-25")],
        )
        .await;
    assert_eq!(
        (mismatch.status, mismatch.body["error"]["code"].clone()),
        (400, json!(-32020))
    );
    let version = json!({ "io.modelcontextprotocol/protocolVersion": "2099-01-01" });
    let future = json!({ "_meta": merge(&envelope(), &version) });
    let unsupported = m
        .rpc(
            "events/list",
            future,
            "reader",
            &[("MCP-Protocol-Version", "2099-01-01")],
        )
        .await;
    assert_eq!(
        (unsupported.status, unsupported.body["error"]["code"].clone()),
        (400, json!(-32022))
    );
    let method = m
        .rpc("events/list", json!({}), "reader", &[("MCP-Method", "tools/list")])
        .await;
    assert_eq!(method.body["error"]["code"], -32020);
    let profile = json!({ "name": "get_profile", "arguments": {} });
    let name = m
        .rpc("tools/call", profile.clone(), "reader", &[("MCP-Name", "wrong")])
        .await;
    assert_eq!(name.body["error"]["code"], -32020);
    let missing = m.rpc("tools/call", profile, "reader", &[("MCP-Name", "")]).await;
    assert_eq!(missing.body["error"]["code"], -32020);
    let mut no_client = envelope();
    no_client
        .as_object_mut()
        .unwrap()
        .remove("io.modelcontextprotocol/clientInfo");
    assert_eq!(
        m.rpc("events/list", json!({ "_meta": no_client }), "reader", &[])
            .await
            .status,
        200
    );
    nothing_dispatched(&m);
}

#[tokio::test]
async fn event_arguments_reject_owner_overrides_and_unsupported_filters_or_delivery_modes() {
    let m = Mcp::new().await;
    let sub = subscription();
    let with = |extra: Value| merge(&sub, &extra);
    let cases = [
        json!({}),
        with(json!({ "name": "other.event" })),
        with(json!({ "sessionId": "session-b" })),
        with(json!({ "principalId": "other-principal" })),
        with(json!({ "arguments": { "sessionId": "session-b" } })),
        with(json!({ "arguments": { "jid": "../invalid" } })),
        with(json!({ "delivery": merge(&sub["delivery"], &json!({ "mode": "stream" })) })),
        with(json!({ "cursor": "past-history" })),
        with(json!({ "ttlMs": -1 })),
        with(json!({ "ttlMs": "1000" })),
    ];
    for params in cases {
        let result = m.rpc("events/subscribe", params.clone(), "reader", &[]).await;
        assert_eq!(result.body["error"]["code"], -32602, "{params} -> {}", result.text);
    }
    let destination = json!({ "name": "message.created", "arguments": {} });
    assert_eq!(
        m.rpc("events/unsubscribe", destination, "reader", &[]).await.body["error"]["code"],
        -32602
    );
    assert_eq!(
        m.rpc("events/list", json!({ "cursor": "unknown" }), "reader", &[])
            .await
            .body["error"]["code"],
        -32602
    );
    nothing_dispatched(&m);
}

/// Node swapped the authenticator between the endpoint check and the operation. The Rust stack
/// re-resolves the credential inside each operation; the revocation is injected through the
/// callback verification hook (events) and checked via insufficient scope (tools).
#[tokio::test]
async fn credentials_are_resolved_again_before_each_event_or_tool_operation() {
    let m = Mcp::new().await;
    let (store, session, token) = (m.f.store.clone(), m.session.id.clone(), m.reader_id.clone());
    *m.callback_hooks.on_verify.lock() = Some(Arc::new(move || store.revoke(&session, &token).expect("revoke")));
    let revoked = m.rpc("events/subscribe", subscription(), "reader", &[]).await;
    assert_eq!(revoked.body["error"]["code"], -32001, "{}", revoked.text);
    assert!(m.f.store.subscriptions(Some(&m.session.id)).unwrap().is_empty());

    let call = json!({ "name": "send_message", "arguments": { "jid": JID, "text": "blocked" } });
    let reduced = m.rpc("tools/call", call, "oauth", &[]).await;
    assert_eq!(reduced.body["result"]["isError"], true);
    let challenge = reduced.body["result"]["_meta"]["mcp/www_authenticate"][0]
        .as_str()
        .unwrap_or_default();
    assert!(challenge.contains("insufficient_scope"), "{challenge}");
    assert!(m.f.wa.sent().is_empty());
    assert_eq!(m.audit_count(), 0);
}

#[tokio::test]
async fn event_notifications_without_request_ids_do_not_create_subscriptions() {
    let m = Mcp::new().await;
    let params = merge(&subscription(), &json!({ "_meta": envelope() }));
    let body = json!({ "jsonrpc": "2.0", "method": "events/subscribe", "params": params });
    let notification = m.raw(Some(body), "reader", &[], "POST").await;
    assert_eq!(notification.status, 202);
    assert!(notification.text.is_empty());
    nothing_dispatched(&m);
}

#[tokio::test]
async fn malformed_and_oversized_json_produce_safe_protocol_errors_before_dispatch() {
    let m = Mcp::new().await;
    let oversized = json!({ "secret": "x".repeat(256 * 1024) }).to_string();
    let cases = [
        (r#"{"jsonrpc":"2.0","secret":"never-expose","#.to_string(), 400, -32700),
        (oversized, 413, -32600),
    ];
    for (body, status, code) in cases {
        let request = axum::http::Request::builder()
            .method("POST")
            .uri(format!("/mcp/{}", m.session.id))
            .header("host", "wamcp.test")
            .header("authorization", format!("Bearer {}", m.reader))
            .header("content-type", "application/json")
            .body(Body::from(body))
            .unwrap();
        let reply = send(&m.router, request).await;
        assert_eq!(reply.status, status);
        assert_eq!(reply.body["jsonrpc"], "2.0");
        assert_eq!(reply.body["id"], Value::Null);
        assert!(reply.body.as_object().is_some_and(|o| o.contains_key("id")));
        assert_eq!(reply.body["error"]["code"], code);
        assert!(
            !["never-expose", "xxxx", "SyntaxError"]
                .iter()
                .any(|s| reply.text.contains(s)),
            "{}",
            reply.text
        );
    }
    nothing_dispatched(&m);
}
