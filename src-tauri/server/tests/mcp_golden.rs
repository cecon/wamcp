//! Replays the MCP contract captured from the Node server (`golden/mcp.json`, 51 cases recorded by
//! `capture-mcp.mjs` against stub services) on the Rust endpoint with real credentials.
//!
//! Status, routing/auth headers, JSON-RPC errors (code, message, data) and envelopes are compared
//! exactly; `session-a` is replaced by the real session id and `serverInfo.version` is ignored.
//! Tool results whose content came from Node stub data are compared structurally (see `STRUCTURAL`).
//! The golden fixture had the helpdesk configured, so every tool list holds all 13 tools, as in Rust
//! (the `catalog_*` tools added later are left out of the comparison).
mod common;
mod mcp_support;

use common::http::Reply;
use mcp_support::golden::compare;
use mcp_support::{Mcp, JID};
use serde_json::Value;
use wamcp_server::application::ports::MirrorRepo;
use wamcp_server::domain::model::ChatUpdate;

const GOLDEN: &str = include_str!("golden/mcp.json");

fn cases(session: &str) -> Vec<Value> {
    serde_json::from_str(&GOLDEN.replace("session-a", session)).expect("golden JSON")
}

/// Data the stub services returned in Node, recreated in the real store.
async fn world() -> Mcp {
    let m = Mcp::new().await;
    m.mirror("message-a", "Visible message", false);
    m.mirror("message-b", "oi, tudo bem?", false);
    m.mirror("a", "", true);
    let chat = ChatUpdate {
        jid: JID.into(),
        name: Some("Xavier".into()),
        updated: common::START,
    };
    m.f.store.upsert_chat(&m.session.id, &chat).expect("chat");
    for (n, jid) in ["5511900000001", "5511900000002", "5511900000003"].iter().enumerate() {
        let (id, jid) = (format!("IN{n}"), format!("{jid}@s.whatsapp.net"));
        m.f.incoming(
            &m.session.id,
            common::Incoming {
                id: &id,
                jid: &jid,
                ..Default::default()
            },
        );
    }
    let helpdesk = &m.f.app.state.support().helpdesk;
    let bot = helpdesk.bot_for(&m.session.id).expect("bot");
    helpdesk
        .toggle_status(&bot, 3, "pending", None)
        .expect("pending conversation");
    m
}

async fn send(m: &Mcp, case: &Value) -> Reply {
    let request = &case["request"];
    let credential = request["credential"].as_str().unwrap_or("reader");
    let method = request["method"].as_str().unwrap_or("POST");
    let headers: Vec<(String, String)> = request["headers"]
        .as_object()
        .map(|h| {
            h.iter()
                .map(|(k, v)| (k.clone(), v.as_str().unwrap_or_default().to_string()))
                .collect()
        })
        .unwrap_or_default();
    let pairs: Vec<(&str, &str)> = headers.iter().map(|(k, v)| (k.as_str(), v.as_str())).collect();
    m.raw(request.get("body").cloned(), credential, &pairs, method).await
}

/// Replays the named golden cases in capture order on one fresh world.
async fn replay(names: &[&str]) {
    let m = world().await;
    let all = cases(&m.session.id);
    let mut errors = Vec::new();
    for name in names {
        let case = all
            .iter()
            .find(|c| c["name"] == *name)
            .unwrap_or_else(|| panic!("golden case {name}"));
        if *name == "event_error" {
            *m.f.callback.verify_error.lock() = Some("timeout".into());
        }
        let reply = send(&m, case).await;
        errors.extend(compare(case, &reply));
    }
    assert!(errors.is_empty(), "golden mismatches:\n{}", errors.join("\n"));
}

const ENVELOPE: [&str; 17] = [
    "notification",
    "meta_empty",
    "meta_version_number",
    "header_mismatch",
    "unsupported_version",
    "method_header_mismatch",
    "name_header_mismatch",
    "invalid_null",
    "invalid_number",
    "invalid_string",
    "invalid_jsonrpc_1",
    "invalid_id_null",
    "invalid_id_object",
    "invalid_method_number",
    "invalid_params_array",
    "invalid_batch",
    "unknown_method",
];
const HTTP: [&str; 3] = ["no_auth", "origin", "get_verb"];
const LISTS: [&str; 3] = ["discover", "tools_list_reader", "tools_list_writer"];
const TOOLS: [&str; 11] = [
    "profile",
    "session_status",
    "list_chats",
    "get_messages",
    "get_messages_bad_jid",
    "search",
    "send_reader",
    "send_writer",
    "send_invalid",
    "media_audio",
    "unknown_tool",
];
const HELPDESK: [&str; 4] = [
    "list_conversations",
    "get_conversation",
    "reply_conversation",
    "reply_conversation_reader",
];
const EVENTS: [&str; 4] = ["events_list", "events_subscribe", "events_unsubscribe", "events_bad"];
const LEGACY: [&str; 7] = [
    "legacy_initialize",
    "legacy_tools_list",
    "legacy_profile",
    "legacy_initialized_notification",
    "legacy_ping",
    "legacy_events_list",
    "legacy_unknown",
];
const ALONE: [&str; 2] = ["ping_modern", "event_error"];

#[test]
fn every_golden_case_is_replayed() {
    let groups = [
        &ENVELOPE[..],
        &HTTP,
        &LISTS,
        &TOOLS,
        &HELPDESK,
        &EVENTS,
        &LEGACY,
        &ALONE,
    ];
    let mut covered: Vec<&str> = groups.iter().flat_map(|g| g.iter().copied()).collect();
    let mut golden: Vec<String> = cases("s")
        .iter()
        .map(|c| c["name"].as_str().unwrap_or_default().into())
        .collect();
    covered.sort_unstable();
    golden.sort();
    assert_eq!(golden.len(), 51);
    assert_eq!(covered, golden.iter().map(String::as_str).collect::<Vec<_>>());
}

#[tokio::test]
async fn envelope_and_json_rpc_validation_errors_match_node() {
    replay(&ENVELOPE).await;
}

#[tokio::test]
async fn http_level_rejections_match_node() {
    replay(&HTTP).await;
}

#[tokio::test]
async fn discovery_and_tool_catalogs_match_node() {
    replay(&LISTS).await;
}

#[tokio::test]
async fn session_tool_calls_match_node() {
    replay(&TOOLS).await;
}

#[tokio::test]
async fn helpdesk_tool_calls_match_node() {
    replay(&HELPDESK).await;
}

#[tokio::test]
async fn event_methods_match_node() {
    replay(&EVENTS).await;
}

#[tokio::test]
async fn legacy_2025_traffic_matches_node() {
    replay(&LEGACY).await;
}

#[tokio::test]
async fn modern_ping_is_not_a_method_like_node() {
    replay(&["ping_modern"]).await;
}

#[tokio::test]
async fn event_callback_errors_match_node() {
    replay(&["event_error"]).await;
}
