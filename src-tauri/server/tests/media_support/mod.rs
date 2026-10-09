//! Helpers shared by the media tests: mirrored audio with a download payload and MCP `get_media`.
#![allow(dead_code)]
use crate::common::http::{request, send, Reply};
use serde_json::{json, Value};
use wamcp_server::adapters::outbound::sqlite::SqliteStore;
use wamcp_server::application::ports::{HistoryPage, MirrorRepo};
use wamcp_server::compose::App;
use wamcp_server::domain::model::{MediaMetadata, WaMessage};

pub const JID: &str = "5511999999999@s.whatsapp.net";
pub const MAX_MEDIA_BYTES: usize = 10 * 1024 * 1024;
pub const PAYLOAD: &[u8] = b"mediaKey=private-key;url=https://example.invalid/private-media";

pub fn message(id: &str, kind: &str, body: &str) -> WaMessage {
    WaMessage {
        id: id.into(),
        jid: JID.into(),
        alt_jid: None,
        from_me: false,
        sender: "Cliente".into(),
        push_name: Some("Cliente".into()),
        body: body.into(),
        kind: kind.into(),
        ts: 100,
    }
}

pub fn audio_meta(size: i64) -> MediaMetadata {
    MediaMetadata {
        kind: "audio".into(),
        mime_type: "audio/ogg; codecs=opus".into(),
        file_name: None,
        size: Some(size),
        duration: Some(3),
        voice: true,
    }
}

pub fn store_audio(store: &SqliteStore, session_id: &str, id: &str, size: i64) {
    let media = audio_meta(size);
    store
        .store_message(session_id, &message(id, "audioMessage", ""), Some((&media, PAYLOAD)))
        .expect("audio");
}

pub fn page() -> HistoryPage {
    HistoryPage {
        before: None,
        before_id: None,
        limit: 100,
    }
}

/// Calls an MCP tool on `/mcp/{session}` (2025-era JSON-RPC) and returns the HTTP reply.
pub async fn call(app: &App, session_id: &str, token: &str, name: &str, arguments: Value) -> Reply {
    let params = json!({ "name": name, "arguments": arguments });
    rpc(
        app,
        session_id,
        token,
        json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": params }),
    )
    .await
}

pub async fn rpc(app: &App, session_id: &str, token: &str, body: Value) -> Reply {
    let auth = format!("Bearer {token}");
    let headers = [
        ("authorization", auth.as_str()),
        ("accept", "application/json, text/event-stream"),
    ];
    send(
        &app.public_router(),
        request("POST", &format!("/mcp/{session_id}"), Some(body), &headers),
    )
    .await
}

pub async fn get_media(app: &App, session_id: &str, token: &str, jid: &str, id: &str) -> Value {
    let reply = call(
        app,
        session_id,
        token,
        "get_media",
        json!({ "jid": jid, "messageId": id }),
    )
    .await;
    assert_eq!(reply.status, 200, "{}", reply.text);
    reply.body["result"].clone()
}

pub fn audited(store: &SqliteStore, session_id: &str) -> Vec<String> {
    store
        .audit_events(session_id)
        .expect("audit")
        .into_iter()
        .map(|e| e.action)
        .collect()
}
