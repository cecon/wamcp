//! Port of `tests/mcp-events-protocol.test.mjs`: modern (2026-07-28) discovery, tools and events on
//! the authenticated MCP endpoint, over the real stack (SQLite store, issued tokens, OAuth grant).
//!
//! Differences from the Node stub fixture: the Rust catalog always lists `send_message` (gated at
//! call time by scope), and the helpdesk is configured, so `tools/list` returns 7 session tools plus
//! 6 helpdesk conversation tools (13) for any credential; without the helpdesk it returns 7.
mod common;
mod mcp_support;

use mcp_support::{merge, subscription, Mcp, JID, VERSION};
use serde_json::{json, Value};
use wamcp_server::application::ports::{EventRepo, MirrorRepo};

const SEND_TOOLS: [&str; 5] = [
    "send_message",
    "reply_conversation",
    "set_conversation_status",
    "assign_conversation",
    "set_conversation_labels",
];

fn tool<'a>(tools: &'a Value, name: &str) -> &'a Value {
    tools
        .as_array()
        .and_then(|t| t.iter().find(|t| t["name"] == name))
        .unwrap_or(&Value::Null)
}

#[tokio::test]
async fn modern_discovery_and_tools_work_without_initialize() {
    let mut m = Mcp::new().await;
    let discover = m.rpc("server/discover", json!({}), "reader", &[]).await;
    assert_eq!(discover.status, 200);
    assert_eq!(discover.header("mcp-session-id"), None);
    let result = &discover.body["result"];
    assert_eq!(result["resultType"], "complete");
    assert_eq!(result["supportedVersions"], json!([VERSION]));
    assert_eq!(result["capabilities"]["events"], json!({}));
    assert!(result["capabilities"]["tools"].is_object());
    assert_eq!(result["_meta"]["io.modelcontextprotocol/serverInfo"]["name"], "wamcp");

    let tools = m.rpc("tools/list", json!({}), "reader", &[]).await.body["result"].clone();
    assert_eq!(tools["resultType"], "complete");
    assert_eq!(
        tools["tools"].as_array().map(Vec::len),
        Some(13),
        "7 session tools + 6 helpdesk tools"
    );
    for t in tools["tools"].as_array().unwrap() {
        let sends = SEND_TOOLS.contains(&t["name"].as_str().unwrap_or_default());
        let scopes = if sends {
            json!(["whatsapp:read", "whatsapp:send"])
        } else {
            json!(["whatsapp:read"])
        };
        assert_eq!(
            t["securitySchemes"],
            json!([{ "type": "oauth2", "scopes": scopes }]),
            "{}",
            t["name"]
        );
        assert_eq!(t["_meta"]["securitySchemes"], t["securitySchemes"]);
        assert_eq!(t["annotations"]["readOnlyHint"], !sends, "{}", t["name"]);
    }
    assert_eq!(tool(&tools["tools"], "get_profile")["_meta"]["openai/profile"], true);

    let profile = m
        .rpc(
            "tools/call",
            json!({ "name": "get_profile", "arguments": {} }),
            "reader",
            &[],
        )
        .await;
    assert_eq!(profile.body["result"]["resultType"], "complete");
    assert_eq!(
        profile.body["result"]["structuredContent"],
        json!({ "id": m.session.id, "name": "Session A" })
    );

    m.mirror("message-a", "Visible message", false);
    let messages = m.rpc(
        "tools/call",
        json!({ "name": "get_messages", "arguments": { "jid": JID } }),
        "reader",
        &[],
    );
    let text = messages.await.body["result"]["content"][0]["text"]
        .as_str()
        .unwrap_or_default()
        .to_string();
    let parsed: Value = serde_json::from_str(&text).expect("JSON text content");
    assert_eq!(parsed[0]["body"], "Visible message");

    m.without(false, true);
    let plain = m.rpc("tools/list", json!({}), "reader", &[]).await.body["result"]["tools"].clone();
    assert_eq!(
        plain.as_array().map(Vec::len),
        Some(7),
        "without the helpdesk only the session tools are listed"
    );
}

#[tokio::test]
async fn event_lifecycle_keeps_stable_owner_identity_and_modern_envelopes() {
    let m = Mcp::new().await;
    let catalog = m.rpc("events/list", json!({}), "reader", &[]).await.body["result"].clone();
    assert_eq!(catalog["resultType"], "complete");
    assert_eq!(catalog["events"][0]["name"], "message.created");
    assert_eq!(catalog["events"][0]["delivery"], json!(["webhook"]));

    let subscribed = m.rpc("events/subscribe", subscription(), "reader", &[]).await.body["result"].clone();
    assert_eq!(subscribed["resultType"], "complete");
    assert!(
        subscribed["id"].as_str().is_some_and(|id| id.starts_with("sub_")),
        "{subscribed}"
    );
    assert_eq!(subscribed["cursor"], Value::Null);
    assert_eq!(subscribed["truncated"], false);
    let stored = m.f.store.subscriptions(Some(&m.session.id)).expect("subscriptions");
    assert_eq!(stored.len(), 1);
    let owner = (
        stored[0].session_id.as_str(),
        stored[0].principal_id.as_str(),
        stored[0].principal_kind.as_str(),
    );
    assert_eq!(owner, (m.session.id.as_str(), m.reader_id.as_str(), "token"));
    assert!(
        !serde_json::to_string(&stored[0]).unwrap().contains(&m.reader),
        "the bearer is never stored"
    );

    let sub = subscription();
    let delivery = json!({ "mode": "webhook", "url": sub["delivery"]["url"] });
    let unsubscribe = json!({ "name": sub["name"], "arguments": sub["arguments"], "delivery": delivery });
    let with_secret = merge(&unsubscribe, &json!({ "delivery": sub["delivery"] }));
    let rejected = m.rpc("events/unsubscribe", with_secret, "oauth", &[]).await;
    assert_eq!(
        rejected.body["error"]["code"], -32602,
        "unsubscribe never takes the secret"
    );

    m.rpc("events/subscribe", subscription(), "oauth", &[]).await;
    let stored = m.f.store.subscriptions(Some(&m.session.id)).expect("subscriptions");
    let oauth = stored
        .iter()
        .find(|s| s.principal_kind == "oauth")
        .expect("oauth-owned subscription");
    assert_eq!(oauth.principal_id, m.grant_id);
    let removed = m.rpc("events/unsubscribe", unsubscribe, "oauth", &[]).await.body["result"].clone();
    assert_eq!(removed["resultType"], "complete");
    let left = m.f.store.subscriptions(Some(&m.session.id)).expect("subscriptions");
    assert_eq!(left.len(), 1, "an OAuth client only removes its own subscription");
    assert_eq!(left[0].principal_kind, "token");
}

#[tokio::test]
async fn events_are_neither_advertised_nor_served_unless_configured() {
    let mut m = Mcp::new().await;
    m.without(true, false);
    let discover = m.rpc("server/discover", json!({}), "reader", &[]).await;
    assert_eq!(discover.body["result"]["capabilities"].get("events"), None);
    assert_eq!(
        m.rpc("events/list", json!({}), "reader", &[]).await.body["error"]["code"],
        -32601
    );
    let tools = m.rpc("tools/list", json!({}), "reader", &[]).await.body["result"]["tools"].clone();
    assert!(tools.as_array().is_some_and(|t| !t.is_empty()));
}

#[tokio::test]
async fn modern_calls_keep_read_write_gating_security_annotations_and_media() {
    let m = Mcp::new().await;
    let params = json!({ "name": "send_message", "arguments": { "jid": JID, "text": "Explicitly authorized test" } });
    let denied = m.rpc("tools/call", params.clone(), "reader", &[]).await;
    assert!(denied.body.get("error").is_some() || denied.body["result"]["isError"] == true);
    assert!(m.f.wa.sent().is_empty());

    let tools = m.rpc("tools/list", json!({}), "writer", &[]).await.body["result"]["tools"].clone();
    let send = tool(&tools, "send_message");
    assert_eq!(send["annotations"]["readOnlyHint"], false);
    assert_eq!(
        send["securitySchemes"][0]["scopes"],
        json!(["whatsapp:read", "whatsapp:send"])
    );

    let bad = merge(&params, &json!({ "arguments": { "jid": "../bad", "text": "x" } }));
    let invalid = m.rpc("tools/call", bad, "writer", &[]).await;
    assert_eq!(invalid.body["result"]["isError"], true);
    assert!(m.f.wa.sent().is_empty());
    let sent = m.rpc("tools/call", params, "writer", &[]).await;
    assert_eq!(sent.body["result"].get("isError"), None, "{:?}", sent.body);
    assert_eq!(m.f.wa.sent()[0].session_id, m.session.id);

    m.mirror("audio", "", true);
    let call = json!({ "name": "get_media", "arguments": { "jid": JID, "messageId": "audio" } });
    let media = m.rpc("tools/call", call.clone(), "reader", &[]).await;
    let expected = json!({ "type": "audio", "mimeType": "audio/ogg", "data": "AQIDBA==" });
    assert_eq!(media.body["result"]["content"][1], expected);

    let (store, session, token) = (m.f.store.clone(), m.session.id.clone(), m.reader_id.clone());
    *m.wa_hooks.on_media.lock() = Some(std::sync::Arc::new(move || {
        store.revoke(&session, &token).expect("revoke")
    }));
    let revoked = m.rpc("tools/call", call, "reader", &[]).await;
    assert_eq!(revoked.body["result"]["isError"], true);
    assert!(revoked.body["result"]["_meta"]["mcp/www_authenticate"].is_array());
    assert!(
        !revoked.text.contains("AQIDBA"),
        "media downloaded before the revocation is not returned"
    );
}

#[tokio::test]
async fn event_errors_keep_specified_codes_and_safe_callback_reasons() {
    let m = Mcp::new().await;
    *m.f.callback.verify_error.lock() = Some("timeout".into());
    let callback = m.rpc("events/subscribe", subscription(), "reader", &[]).await;
    assert_eq!(callback.body["error"]["code"], -32015);
    assert_eq!(callback.body["error"]["data"], json!({ "reason": "timeout" }));
    // Node maps unexpected exceptions to -32603; the Rust callback port reports reasons, and any
    // reason outside the safe list is normalised to `challenge_failed` without leaking details.
    *m.f.callback.verify_error.lock() = Some("internal-path secret bearer".into());
    let internal = m.rpc("events/subscribe", subscription(), "reader", &[]).await;
    assert_eq!(internal.body["error"]["code"], -32015);
    assert_eq!(internal.body["error"]["data"], json!({ "reason": "challenge_failed" }));
    assert!(!internal.text.contains("internal-path") && !internal.text.contains("secret bearer"));
    assert_eq!(m.f.store.subscriptions(Some(&m.session.id)).unwrap().len(), 0);
}
