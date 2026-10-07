//! MCP events end to end (port of tests/events-end-to-end.test.mjs): HTTP subscribe → verified
//! callback → incoming delivery → authorized reply (no loop) → unsubscribe, over the full stack.
//! The recording callback stands in for the network; signatures are recomputed from what it got.
mod common;

use base64::{engine::general_purpose::STANDARD, Engine};
use common::http::request;
use common::Fixture;
use hmac::{Hmac, Mac};
use serde_json::{json, Value};
use sha2::Sha256;
use wamcp_server::adapters::outbound::event_callback::prepare;
use wamcp_server::application::events::EventService;
use wamcp_server::application::ports::{EventRepo, MirrorRepo};
use wamcp_server::application::whatsapp_sink::{Arrival, WhatsAppEvents};
use wamcp_server::domain::model::WaMessage;

const VERSION: &str = "2026-07-28";
const JID: &str = "5511999999999@s.whatsapp.net";
const CALLBACK: &str = "https://receiver.example/mcp-events/callback";

fn secret() -> String {
    format!("whsec_{}", STANDARD.encode([1_u8; 32]))
}

fn subscription() -> Value {
    json!({
        "name": "message.created",
        "arguments": { "jid": JID },
        "delivery": { "mode": "webhook", "url": CALLBACK, "secret": secret() },
        "cursor": null,
    })
}

fn envelope() -> Value {
    json!({
        "io.modelcontextprotocol/protocolVersion": VERSION,
        "io.modelcontextprotocol/clientCapabilities": {},
        "io.modelcontextprotocol/clientInfo": { "name": "events-test", "version": "1.0.0" },
    })
}

async fn rpc(f: &Fixture, session: &str, token: &str, method: &str, params: Value) -> Value {
    let mut params = params;
    params["_meta"] = envelope();
    let body = json!({ "jsonrpc": "2.0", "id": 1, "method": method, "params": params });
    let auth = format!("Bearer {token}");
    let name = params["name"].as_str().unwrap_or_default().to_string();
    let mut headers = vec![
        ("authorization", auth.as_str()),
        ("accept", "application/json, text/event-stream"),
        ("mcp-protocol-version", VERSION),
        ("mcp-method", method),
    ];
    if !name.is_empty() {
        headers.push(("mcp-name", name.as_str()));
    }
    let reply = f
        .public(request("POST", &format!("/mcp/{session}"), Some(body), &headers))
        .await;
    assert_eq!(reply.status, 200, "{method}: {}", reply.text);
    assert!(reply.body.get("error").is_none(), "{method}: {}", reply.body["error"]);
    reply.body["result"].clone()
}

fn message(id: &str, jid: &str, from_me: bool, text: &str) -> WaMessage {
    WaMessage {
        id: id.into(),
        jid: jid.into(),
        alt_jid: None,
        from_me,
        sender: if from_me { jid.into() } else { "Cliente".into() },
        push_name: None,
        body: text.into(),
        kind: "conversation".into(),
        ts: 1000,
    }
}

fn ingest(f: &Fixture, session: &str, item: &WaMessage, arrival: Arrival) {
    f.app.sink.message(session, item, None, arrival, f.now());
}

fn events(f: &Fixture) -> EventService {
    f.app.state.events.clone().expect("events service")
}

/// Recomputes the Standard Webhooks signature the HTTP adapter would send for this delivery.
fn assert_signed(subscription: &str, secrets: &[String], event: &Value) {
    let id = event["eventId"].as_str().expect("event id");
    let prepared = prepare(CALLBACK, subscription, secrets, event, id, "1800000000").expect("prepared");
    let key = STANDARD.decode(&secret()[6..]).expect("key");
    let mut mac = Hmac::<Sha256>::new_from_slice(&key).expect("hmac");
    mac.update(format!("{id}.1800000000.{}", prepared.body).as_bytes());
    let expected = format!("v1,{}", STANDARD.encode(mac.finalize().into_bytes()));
    let header = |name: &str| {
        prepared
            .headers
            .iter()
            .find(|(n, _)| *n == name)
            .map(|(_, v)| v.clone())
    };
    assert_eq!(header("webhook-signature"), Some(expected));
    assert_eq!(header("webhook-id").as_deref(), Some(id));
    assert_eq!(header("X-MCP-Subscription-Id").as_deref(), Some(subscription));
}

#[tokio::test]
async fn http_subscribe_signed_callback_incoming_delivery_authorized_reply_and_unsubscribe() {
    let f = Fixture::new().await;
    let (a, b) = (f.session("A"), f.session("B"));
    let token = f
        .store
        .issue_token(&a.id, "Writer", "read_write", 30)
        .expect("token")
        .token;
    assert_eq!(
        rpc(&f, &a.id, &token, "server/discover", json!({})).await["capabilities"]["events"],
        json!({})
    );
    assert_eq!(
        rpc(&f, &a.id, &token, "events/list", json!({})).await["events"][0]["name"],
        "message.created"
    );
    let subscribed = rpc(&f, &a.id, &token, "events/subscribe", subscription()).await;
    let id = subscribed["id"].as_str().expect("id").to_string();
    assert!(id.starts_with("sub_"));
    assert_eq!(*f.callback.verified.lock(), vec![(CALLBACK.to_string(), secret())]);
    let again = rpc(&f, &a.id, &token, "events/subscribe", subscription()).await;
    assert_eq!(again["id"], id.as_str());
    assert_eq!(
        f.callback.verified.lock().len(),
        1,
        "idempotent refresh uses bounded verification cache"
    );

    let hello = "Hello from the controlled upstream";
    ingest(&f, &b.id, &message("other-session", JID, false, hello), Arrival::Notify);
    ingest(
        &f,
        &a.id,
        &message("other-chat", "5511888888888@s.whatsapp.net", false, hello),
        Arrival::Notify,
    );
    ingest(&f, &a.id, &message("received-1", JID, false, hello), Arrival::Notify);
    ingest(&f, &a.id, &message("received-1", JID, false, hello), Arrival::Notify);
    events(&f).flush().await;
    let delivered = f.callback.delivered.lock().clone();
    assert_eq!(delivered.len(), 1);
    let (url, secrets, event) = &delivered[0];
    assert_eq!(url, CALLBACK);
    assert_eq!(secrets, &vec![secret()]);
    assert_eq!(event["data"]["message_id"], "received-1");
    assert_eq!(event["data"]["from_me"], false);
    assert_eq!(event["cursor"], Value::Null);
    assert_signed(&id, secrets, event);

    let arguments = json!({ "jid": JID, "text": "Authorized test reply" });
    let reply = rpc(
        &f,
        &a.id,
        &token,
        "tools/call",
        json!({ "name": "send_message", "arguments": arguments }),
    )
    .await;
    assert!(reply.get("isError").is_none_or(|e| e == false), "{reply}");
    let sent = f.wa.sent();
    assert_eq!(sent.len(), 1);
    assert_eq!(
        (sent[0].session_id.as_str(), sent[0].jid.as_str()),
        (a.id.as_str(), JID)
    );
    assert_eq!(sent[0].text, "Authorized test reply");
    // The adapter echoes our own send back as a live message; it must not loop into an event.
    ingest(
        &f,
        &a.id,
        &message("outbound-reply", JID, true, "Authorized test reply"),
        Arrival::Notify,
    );
    ingest(
        &f,
        &a.id,
        &message("outbound-append", JID, true, "Authorized test reply"),
        Arrival::Append,
    );
    events(&f).flush().await;
    assert_eq!(
        f.callback.delivered.lock().len(),
        1,
        "outbound reply cannot create a response loop"
    );

    let delivery = json!({ "mode": "webhook", "url": CALLBACK });
    let removal = json!({ "name": "message.created", "arguments": { "jid": JID }, "delivery": delivery });
    rpc(&f, &a.id, &token, "events/unsubscribe", removal).await;
    ingest(
        &f,
        &a.id,
        &message("after-unsubscribe", JID, false, hello),
        Arrival::Notify,
    );
    events(&f).flush().await;
    assert_eq!(f.callback.delivered.lock().len(), 1);
    assert!(f.store.subscriptions(None).expect("subscriptions").is_empty());
}

#[tokio::test]
async fn token_revocation_and_logout_drop_subscriptions_through_the_composed_authorizer() {
    let f = Fixture::new().await;
    let a = f.session("A");
    let issued = f.store.issue_token(&a.id, "Reader", "read", 30).expect("token");
    rpc(&f, &a.id, &issued.token, "events/subscribe", subscription()).await;
    assert_eq!(f.store.subscriptions(Some(&a.id)).expect("list").len(), 1);
    f.store.revoke(&a.id, &issued.id).expect("revoke");
    ingest(&f, &a.id, &message("after-revoke", JID, false, "Oi"), Arrival::Notify);
    events(&f).flush().await;
    assert!(f.callback.delivered.lock().is_empty());
    assert!(f.store.subscriptions(None).expect("list").is_empty());

    let next = f.store.issue_token(&a.id, "Reader", "read", 30).expect("token");
    rpc(&f, &a.id, &next.token, "events/subscribe", subscription()).await;
    f.app.sink.logged_out(&a.id);
    assert!(f.store.subscriptions(None).expect("list").is_empty());
}
