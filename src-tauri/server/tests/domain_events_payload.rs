//! MCP events extension: the event definition, live message payloads and the retry policy.
use serde_json::{json, Value};
use wamcp_server::domain::events::*;
use wamcp_server::domain::model::WaMessage;

#[test]
fn the_event_definition_advertises_the_jid_filter_and_payload() {
    let definition = event_definition();
    assert_eq!(definition["name"], EVENT_NAME);
    assert_eq!(definition["delivery"], json!(["webhook"]));
    assert_eq!(definition["inputSchema"]["properties"]["jid"]["pattern"], JID_PATTERN);
    assert_eq!(
        definition["payloadSchema"]["properties"]["text"]["maxLength"],
        MAX_EVENT_TEXT
    );
    assert_eq!(
        definition["payloadSchema"]["required"].as_array().map(Vec::len),
        Some(7)
    );
    assert!(JID.is_match("5511@s.whatsapp.net") && !JID.is_match("@lid"));
}

fn wa(jid: &str, id: &str, body: &str, from_me: bool) -> WaMessage {
    WaMessage {
        id: id.into(),
        jid: jid.into(),
        alt_jid: None,
        from_me,
        sender: "Cliente".into(),
        push_name: None,
        body: body.into(),
        kind: "conversation".into(),
        ts: 1_700_000_000,
    }
}

#[test]
fn live_messages_become_events_with_stable_ids() {
    let hash = |input: &str| format!("h({input})");
    let event = message_event("S", &wa("5511@s.whatsapp.net", "M1", "Olá", false), hash).expect("event");
    assert_eq!(event["eventId"], r#"evt_h(["S","5511@s.whatsapp.net","M1"])"#);
    assert_eq!(event["name"], EVENT_NAME);
    assert_eq!(event["timestamp"], "2023-11-14T22:13:20.000Z");
    assert_eq!(event["cursor"], Value::Null);
    let expected = json!({
        "jid": "5511@s.whatsapp.net", "message_id": "M1", "sender": "Cliente", "text": "Olá",
        "kind": "conversation", "from_me": false, "timestamp": "2023-11-14T22:13:20.000Z", "truncated": false
    });
    assert_eq!(event["data"], expected);

    let mut long = wa("1@lid", "M2", &"x".repeat(MAX_EVENT_TEXT + 1), false);
    long.sender = "s".repeat(400);
    long.kind = "k".repeat(150);
    let event = message_event("S", &long, hash).expect("long event");
    assert_eq!(event["data"]["truncated"], true);
    assert_eq!(event["data"]["text"].as_str().map(str::len), Some(MAX_EVENT_TEXT));
    assert_eq!(event["data"]["sender"].as_str().map(str::len), Some(300));
    assert_eq!(event["data"]["kind"].as_str().map(str::len), Some(100));
    let exact = wa("1@lid", "M3", &"x".repeat(MAX_EVENT_TEXT), false);
    assert_eq!(
        message_event("S", &exact, hash).expect("exact")["data"]["truncated"],
        false
    );

    assert_eq!(
        message_event("S", &wa("1@lid", "M", "x", true), hash),
        None,
        "own messages"
    );
    assert_eq!(message_event("S", &wa("status@broadcast", "M", "x", false), hash), None);
    assert_eq!(
        message_event("S", &wa(&format!("{}@lid", "1".repeat(200)), "M", "x", false), hash),
        None
    );
    assert_eq!(message_event("S", &wa("1@lid", "", "x", false), hash), None);
    assert_eq!(
        message_event("S", &wa("1@lid", &"i".repeat(301), "x", false), hash),
        None
    );
    assert!(message_event("S", &wa("1@lid", &"i".repeat(300), "x", false), hash).is_some());
    assert_eq!(iso_millis(0), "1970-01-01T00:00:00.000Z");
    assert_eq!(iso_millis(1_500), "1970-01-01T00:00:01.500Z");
    assert_eq!(
        iso_millis(i64::MAX),
        "1970-01-01T00:00:00.000Z",
        "out of range reads as the epoch"
    );
}

#[test]
fn transport_failures_timeouts_throttling_and_server_errors_are_retried() {
    for status in [None, Some(0), Some(408), Some(429), Some(500), Some(503)] {
        assert!(retryable(status), "{status:?}");
    }
    for status in [
        Some(200),
        Some(301),
        Some(400),
        Some(401),
        Some(404),
        Some(410),
        Some(499),
    ] {
        assert!(!retryable(status), "{status:?}");
    }
}
