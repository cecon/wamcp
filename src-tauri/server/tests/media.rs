//! Media (port of tests/media.test.mjs): metadata persists without leaking download credentials, and
//! the MCP `get_media` tool is scoped, audited and size-limited.
mod common;
mod media_support;

use common::Fixture;
use media_support::{audited, call, get_media, message, page, rpc, store_audio, JID, MAX_MEDIA_BYTES, PAYLOAD};
use serde_json::{json, Value};
use wamcp_server::adapters::outbound::sqlite::SqliteStore;
use wamcp_server::application::ports::MirrorRepo;
use wamcp_server::domain::model::MediaMetadata;

#[tokio::test]
async fn media_persists_across_restarts_without_leaking_download_credentials() {
    let dir = tempfile::tempdir().expect("dir");
    let store = SqliteStore::open(dir.path()).expect("store");
    let session = store.create_session("Persistent").expect("session");
    store_audio(&store, &session.id, "audio", 4);
    store_audio(&store, &session.id, "audio", 4);
    drop(store);
    let store = SqliteStore::open(dir.path()).expect("reopen");
    let messages = store.mirror_messages(&session.id, JID, &page()).expect("messages");
    assert_eq!(messages.len(), 1);
    assert_eq!(messages[0].kind, "audioMessage");
    let media = messages[0].media.as_ref().expect("media metadata");
    assert!(media.voice);
    assert_eq!((media.duration, media.size), (Some(3), Some(4)));
    let listed = serde_json::to_string(&messages).expect("json");
    for secret in ["private-key", "private-media", "mediaKey", "payload"] {
        assert!(!listed.contains(secret), "history leaks {secret}: {listed}");
    }
    let found = serde_json::to_string(&store.search(&session.id, "", 100).expect("search")).expect("json");
    assert!(
        !found.contains("private-key") && !found.contains("private-media"),
        "{found}"
    );
    let stored = store.media(&session.id, JID, "audio").expect("media").expect("stored");
    assert_eq!(stored.payload, PAYLOAD);
}

#[tokio::test]
async fn existing_text_database_upgrades_without_losing_history() {
    let dir = tempfile::tempdir().expect("dir");
    let store = SqliteStore::open(dir.path()).expect("store");
    let session = store.create_session("Legacy").expect("session");
    store
        .store_message(&session.id, &message("old", "conversation", "kept"), None)
        .expect("text");
    store
        .with(|c| c.execute_batch("DROP TABLE message_media"))
        .expect("drop");
    drop(store);
    let store = SqliteStore::open(dir.path()).expect("reopen");
    let messages = store.mirror_messages(&session.id, JID, &page()).expect("messages");
    assert_eq!(messages[0].body, "kept");
    assert_eq!(messages[0].media, None);
    store_audio(&store, &session.id, "audio", 4);
    assert!(store.media(&session.id, JID, "audio").expect("media").is_some());
}

#[tokio::test]
async fn mcp_returns_native_audio_and_embedded_document_resources_for_read_credentials() {
    let f = Fixture::new().await;
    let session = f.session("Media");
    let token = MirrorRepo::issue_token(&*f.store, &session.id, "Reader", "read", 90)
        .expect("token")
        .token;
    *f.wa.media.lock() = Some(b"data".to_vec());
    store_audio(&f.store, &session.id, "audio", 4);
    let result = get_media(&f.app, &session.id, &token, JID, "audio").await;
    assert_eq!(result.get("isError"), None, "{result}");
    let native = json!({ "type": "audio", "data": "ZGF0YQ==", "mimeType": "audio/ogg; codecs=opus" });
    assert_eq!(result["content"][1], native);
    let described: Value = serde_json::from_str(result["content"][0]["text"].as_str().expect("text")).expect("json");
    assert_eq!(
        (described["type"].clone(), described["size"].clone()),
        (json!("audio"), json!(4))
    );
    assert_eq!(audited(&f.store, &session.id)[0], "get_media");

    let doc = MediaMetadata {
        kind: "document".into(),
        mime_type: "application/pdf".into(),
        file_name: Some("invoice.pdf".into()),
        size: Some(4),
        duration: None,
        voice: false,
    };
    let invoice = message("doc", "documentMessage", "invoice.pdf");
    f.store
        .store_message(&session.id, &invoice, Some((&doc, PAYLOAD)))
        .expect("doc");
    let found = f.store.search(&session.id, "invoice.pdf", 100).expect("search");
    assert_eq!(found[0].media.as_ref().map(|m| m.kind.as_str()), Some("document"));
    let result = get_media(&f.app, &session.id, &token, JID, "doc").await;
    let resource = &result["content"][1];
    assert_eq!(resource["type"], "resource");
    assert_eq!(resource["resource"]["mimeType"], "application/pdf");
    assert_eq!(resource["resource"]["blob"], "ZGF0YQ==");
    assert!(resource["resource"]["uri"]
        .as_str()
        .unwrap_or_default()
        .starts_with("wamcp://sessions/"));
}

#[tokio::test]
// send_message stays discoverable for read-only credentials so clients can request the send scope.
async fn read_credentials_discover_send_message_with_the_send_scope() {
    let f = Fixture::new().await;
    let session = f.session("Media");
    let token = MirrorRepo::issue_token(&*f.store, &session.id, "Reader", "read", 90)
        .expect("token")
        .token;
    let body = json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {} });
    let reply = rpc(&f.app, &session.id, &token, body).await;
    let tools = reply.body["result"]["tools"].as_array().cloned().unwrap_or_default();
    assert!(tools.iter().any(|t| t["name"] == "get_media"));
    let send = tools
        .iter()
        .find(|t| t["name"] == "send_message")
        .expect("send_message listed");
    assert_eq!(
        send["securitySchemes"][0]["scopes"],
        json!(["whatsapp:read", "whatsapp:send"])
    );
}

#[tokio::test]
async fn mcp_refuses_other_sessions_conversations_missing_attachments_and_invalid_ids() {
    let f = Fixture::new().await;
    let session = f.session("Media");
    let other = f.session("Other");
    let token = MirrorRepo::issue_token(&*f.store, &session.id, "Reader", "read", 90)
        .expect("token")
        .token;
    *f.wa.media.lock() = Some(b"data".to_vec());
    store_audio(&f.store, &other.id, "audio", 4);
    assert_eq!(
        get_media(&f.app, &session.id, &token, JID, "audio").await["isError"],
        true
    );
    let foreign = call(
        &f.app,
        &other.id,
        &token,
        "get_media",
        json!({ "jid": JID, "messageId": "audio" }),
    )
    .await;
    assert_eq!(foreign.status, 401);
    store_audio(&f.store, &session.id, "audio", 4);
    let elsewhere = get_media(&f.app, &session.id, &token, "5522999999999@s.whatsapp.net", "audio").await;
    assert_eq!(elsewhere["isError"], true);
    assert_eq!(
        get_media(&f.app, &session.id, &token, JID, "missing").await["isError"],
        true
    );
    assert_eq!(
        get_media(&f.app, &session.id, &token, "../../other", "audio").await["isError"],
        true
    );
    assert!(!audited(&f.store, &session.id).contains(&"get_media".to_string()));
    assert!(!audited(&f.store, &other.id).contains(&"get_media".to_string()));
}

#[tokio::test]
async fn mcp_rejects_oversized_files_before_and_after_download() {
    let f = Fixture::new().await;
    let session = f.session("Media");
    let token = MirrorRepo::issue_token(&*f.store, &session.id, "Reader", "read", 90)
        .expect("token")
        .token;
    *f.wa.media.lock() = Some(b"data".to_vec());
    store_audio(&f.store, &session.id, "large", MAX_MEDIA_BYTES as i64 + 1);
    let large = get_media(&f.app, &session.id, &token, JID, "large").await;
    assert_eq!(large["isError"], true);
    assert!(
        large["content"][0]["text"]
            .as_str()
            .unwrap_or_default()
            .contains("10 MiB"),
        "{large}"
    );
    assert!(
        audited(&f.store, &session.id).is_empty(),
        "no download before the size check"
    );

    store_audio(&f.store, &session.id, "audio", 4);
    *f.wa.media.lock() = Some(vec![0; MAX_MEDIA_BYTES + 1]);
    let actual = get_media(&f.app, &session.id, &token, JID, "audio").await;
    assert_eq!(actual["isError"], true);
    assert!(
        actual["content"][0]["text"]
            .as_str()
            .unwrap_or_default()
            .contains("10 MiB"),
        "{actual}"
    );
    *f.wa.media.lock() = None;
    let offline = get_media(&f.app, &session.id, &token, JID, "audio").await;
    assert_eq!(offline["isError"], true);
    assert!(
        offline["content"][0]["text"]
            .as_str()
            .unwrap_or_default()
            .contains("Conecte a sessão"),
        "{offline}"
    );
}
