//! WhatsApp sink (port of tests/whatsapp-events.test.mjs): live messages are mirrored, published as
//! MCP events only when new, incoming and notified, and fed to the helpdesk only while recent.
mod common;

use common::Fixture;
use serde_json::{json, Map, Value};
use wamcp_server::application::ports::{Clock, EventRepo, HistoryPage, MirrorRepo, Subscription};
use wamcp_server::application::whatsapp_sink::{Arrival, WhatsAppEvents, LIVE_WINDOW_SECONDS};
use wamcp_server::domain::model::{ChatUpdate, WaMessage};

const JID: &str = "5511999999999@s.whatsapp.net";

fn wa(id: &str, jid: &str, kind: &str, body: &str, from_me: bool, ts: i64) -> WaMessage {
    WaMessage {
        id: id.into(),
        jid: jid.into(),
        alt_jid: None,
        from_me,
        sender: if from_me { jid.into() } else { "Cliente".into() },
        push_name: (!from_me).then(|| "Cliente".to_string()),
        body: body.into(),
        kind: kind.into(),
        ts,
    }
}

fn text(f: &Fixture, id: &str) -> WaMessage {
    wa(id, JID, "conversation", "New message", false, f.now())
}

/// Registers an MCP event subscription owned by a fresh session token (no callback verification).
fn subscribe(f: &Fixture, session_id: &str) -> String {
    let token = MirrorRepo::issue_token(&*f.store, session_id, "Events", "read", 30).expect("token");
    let id = format!("sub_{}", token.id);
    let subscription = Subscription {
        session_id: session_id.into(),
        principal_id: token.id,
        principal_kind: "token".into(),
        id: id.clone(),
        name: "message.created".into(),
        args: Map::new(),
        url: "https://hooks.example.com/wamcp".into(),
        secret: "whsec_dGVzdA==".into(),
        expires: f.clock.now_ms() + 3_600_000,
        previous_secret: None,
        rotate_until: None,
    };
    f.store.save_subscription(&subscription).expect("subscription");
    id
}

/// Every queued MCP event (all subscriptions), oldest first.
fn queued(f: &Fixture) -> Vec<Value> {
    let rows = f.store.with(|c| {
        let mut statement = c.prepare("SELECT event FROM event_queue ORDER BY rowid")?;
        let rows = statement.query_map([], |r| r.get::<_, String>(0))?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
    });
    rows.expect("queue")
        .iter()
        .map(|e| serde_json::from_str(e).expect("event json"))
        .collect()
}

fn mirror(f: &Fixture, session_id: &str, jid: &str) -> Vec<String> {
    let page = HistoryPage {
        before: None,
        before_id: None,
        limit: 100,
    };
    f.store
        .mirror_messages(session_id, jid, &page)
        .expect("mirror")
        .into_iter()
        .map(|m| m.id)
        .collect()
}

#[tokio::test]
async fn only_new_incoming_notify_messages_are_published_never_history_or_outbound_echoes() {
    let f = Fixture::new().await;
    let session = f.session("Events");
    subscribe(&f, &session.id);
    let (sink, now) = (&f.app.sink, f.now());
    f.store
        .store_message(&session.id, &text(&f, "history"), None)
        .expect("history");
    sink.message(&session.id, &text(&f, "history"), None, Arrival::Notify, now);
    sink.message(&session.id, &text(&f, "new"), None, Arrival::Notify, now);
    sink.message(&session.id, &text(&f, "new"), None, Arrival::Notify, now);
    sink.message(&session.id, &text(&f, "offline"), None, Arrival::Append, now);
    sink.message(&session.id, &text(&f, "synced"), None, Arrival::History, now);
    sink.message(
        &session.id,
        &wa("own", JID, "conversation", "eco", true, now),
        None,
        Arrival::Notify,
        now,
    );
    let status = wa("status", "status@broadcast", "conversation", "story", false, now);
    sink.message(&session.id, &status, None, Arrival::Notify, now);
    let control = wa("control", JID, "protocolMessage", "", false, now);
    sink.message(&session.id, &control, None, Arrival::Notify, now);

    let events = queued(&f);
    assert_eq!(events.len(), 1, "{events:?}");
    assert_eq!(events[0]["name"], "message.created");
    assert_eq!(events[0]["data"]["message_id"], "new");
    assert_eq!(events[0]["data"]["jid"], JID);
    assert_eq!(events[0]["data"]["from_me"], false);
    assert_eq!(events[0]["data"]["text"], "New message");
    assert_eq!(mirror(&f, &session.id, JID).len(), 6);
}

#[tokio::test]
async fn control_kinds_are_mirrored_but_never_published() {
    let f = Fixture::new().await;
    let session = f.session("Control");
    subscribe(&f, &session.id);
    let now = f.now();
    let kinds = [
        "protocolMessage",
        "reactionMessage",
        "senderKeyDistributionMessage",
        "unknown",
    ];
    for (n, kind) in kinds.iter().enumerate() {
        let message = wa(&format!("C{n}"), JID, kind, "", false, now);
        f.app.sink.message(&session.id, &message, None, Arrival::Notify, now);
    }
    assert!(queued(&f).is_empty());
    assert_eq!(mirror(&f, &session.id, JID).len(), 4);
}

#[tokio::test]
async fn live_message_deduplication_is_scoped_to_its_whatsapp_session() {
    let f = Fixture::new().await;
    let (a, b) = (f.session("A"), f.session("B"));
    let same = text(&f, "same");
    assert!(f.store.store_message(&a.id, &same, None).expect("a"));
    assert!(f.store.store_message(&b.id, &same, None).expect("b"));
    assert!(!f.store.store_message(&a.id, &same, None).expect("a again"));
    assert_eq!(mirror(&f, &a.id, JID), vec!["same"]);
    assert_eq!(mirror(&f, &b.id, JID), vec!["same"]);
}

#[tokio::test]
async fn explicit_disconnect_clears_subscriptions_and_stops_whatsapp() {
    let f = Fixture::new().await;
    let session = f.session("Stop");
    let other = f.session("Other");
    let mine = subscribe(&f, &session.id);
    let kept = subscribe(&f, &other.id);
    f.admin("POST", &format!("/api/sessions/{}/connect", session.id), None)
        .await;
    assert!(f.wa.connected.lock().contains(&session.id));
    let reply = f
        .admin("POST", &format!("/api/sessions/{}/logout", session.id), None)
        .await;
    assert_eq!(reply.status, 200);
    assert_eq!(reply.body, json!({ "ok": true }));
    assert!(!f.wa.connected.lock().contains(&session.id));
    assert!(f.store.subscription(&mine).expect("lookup").is_none());
    assert!(f.store.subscription(&kept).expect("lookup").is_some());
}

#[tokio::test]
async fn group_content_bundled_with_sender_key_is_published_key_only_control_is_not() {
    let f = Fixture::new().await;
    let session = f.session("Group");
    subscribe(&f, &session.id);
    let now = f.now();
    let image = wa(
        "group-image",
        "123456@g.us",
        "imageMessage",
        "Please review this",
        false,
        now,
    );
    let key_only = wa("key-only", JID, "senderKeyDistributionMessage", "", false, now);
    f.app.sink.message(&session.id, &image, None, Arrival::Notify, now);
    f.app.sink.message(&session.id, &key_only, None, Arrival::Notify, now);
    let events = queued(&f);
    assert_eq!(events.len(), 1);
    assert_eq!(events[0]["data"]["kind"], "imageMessage");
    assert_eq!(events[0]["data"]["text"], "Please review this");
}

#[tokio::test]
async fn helpdesk_only_receives_recent_live_messages_and_own_echoes() {
    let f = Fixture::new().await;
    let session = f.session("Suporte");
    let admin = f.bootstrap().await;
    let now = f.now();
    let old = now - LIVE_WINDOW_SECONDS - 60;
    let customer = |id: &str, ts: i64| wa(id, JID, "conversation", id, false, ts);
    f.app
        .sink
        .message(&session.id, &customer("history", now), None, Arrival::History, now);
    f.app
        .sink
        .message(&session.id, &customer("stale", old), None, Arrival::Notify, now);
    f.app
        .sink
        .message(&session.id, &customer("offline", now), None, Arrival::Append, now);
    f.app.sink.message(
        &session.id,
        &wa("R1", JID, "reactionMessage", "👍", false, now),
        None,
        Arrival::Notify,
        now,
    );
    assert_eq!(admin.get("/conversations").await.body, json!([]));
    assert_eq!(mirror(&f, &session.id, JID).len(), 4);

    f.app
        .sink
        .message(&session.id, &customer("live", now), None, Arrival::Notify, now);
    f.app
        .sink
        .message(&session.id, &customer("live", now), None, Arrival::Notify, now);
    let own = wa("echo", JID, "conversation", "Resposta pelo celular", true, now);
    f.app.sink.message(&session.id, &own, None, Arrival::Append, now);
    let list = admin.get("/conversations").await.body;
    assert_eq!(list.as_array().map(Vec::len), Some(1), "{list}");
    let messages = admin.get("/conversations/1/messages").await.body;
    let kinds: Vec<Value> = messages
        .as_array()
        .expect("messages")
        .iter()
        .filter(|m| m["message_type"] != "activity")
        .map(|m| json!([m["message_type"], m["content"]]))
        .collect();
    assert_eq!(
        kinds,
        vec![
            json!(["incoming", "live"]),
            json!(["outgoing", "Resposta pelo celular"])
        ]
    );
}

#[tokio::test]
async fn status_chats_receipts_and_logout_update_the_mirror() {
    let f = Fixture::new().await;
    let session = f.session("Status");
    let sub = subscribe(&f, &session.id);
    f.app.sink.status(&session.id, "connected", Some("5511900000000"));
    let stored = f.store.session(&session.id).expect("session").expect("exists");
    assert_eq!(
        (stored.status.as_str(), stored.phone.as_deref()),
        ("connected", Some("5511900000000"))
    );
    f.app.sink.chat(
        &session.id,
        &ChatUpdate {
            jid: JID.into(),
            name: Some("Maria".into()),
            updated: 10,
        },
    );
    f.app.sink.chat(
        &session.id,
        &ChatUpdate {
            jid: JID.into(),
            name: None,
            updated: 5,
        },
    );
    let chats = f.store.chats(&session.id, "").expect("chats");
    assert_eq!((chats[0].name.as_deref(), chats[0].updated), (Some("Maria"), 10));
    f.app.sink.receipt(&session.id, "unknown-id", "read");
    f.app.sink.logged_out(&session.id);
    let stored = f.store.session(&session.id).expect("session").expect("exists");
    assert_eq!(stored.status, "logged_out");
    assert!(f.store.subscription(&sub).expect("lookup").is_none());
}
