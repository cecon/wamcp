//! Quotes, reactions, deletions, edits, retries, typing indicators and read receipts.
mod common;

use common::{Fixture, Incoming};
use serde_json::{json, Value};
use wamcp_server::application::ports::Typing;
use wamcp_server::application::whatsapp_sink::WhatsAppEvents;

const JID: &str = "5511988887777@s.whatsapp.net";

async fn conversation_with_message(f: &Fixture) -> (common::Agent, String, i64) {
    let session = f.session("Suporte");
    let admin = f.bootstrap().await;
    f.incoming(
        &session.id,
        Incoming {
            id: "IN1",
            body: "Qual o prazo?",
            ..Default::default()
        },
    );
    let messages = admin.get("/conversations/1/messages").await.body;
    let id = messages[0]["id"].as_i64().unwrap();
    (admin, session.id, id)
}

#[tokio::test]
async fn agents_quote_messages_and_contacts_quotes_are_linked() {
    let f = Fixture::new().await;
    let (admin, session, incoming) = conversation_with_message(&f).await;
    let reply = admin
        .post(
            "/conversations/1/messages",
            json!({ "content": "3 dias", "in_reply_to": incoming }),
        )
        .await;
    assert_eq!(reply.status, 201);
    assert_eq!(reply.body["content_attributes"]["in_reply_to"], incoming);
    assert_eq!(reply.body["content_attributes"]["in_reply_to_external_id"], "IN1");
    let quote = f.wa.requests.lock().last().cloned().unwrap().quote.unwrap();
    assert_eq!(
        (quote.id.as_str(), quote.from_me, quote.text.as_str()),
        ("IN1", false, "Qual o prazo?")
    );
    let missing = admin
        .post(
            "/conversations/1/messages",
            json!({ "content": "x", "in_reply_to": 999 }),
        )
        .await;
    assert_eq!(missing.status, 422);

    let our = reply.body["source_id"].as_str().unwrap().to_string();
    f.incoming(
        &session,
        Incoming {
            id: "IN2",
            body: "Obrigado",
            ..Default::default()
        },
    );
    f.app.sink.quoted(&session, "IN2", &our);
    let messages = admin.get("/conversations/1/messages").await.body;
    let thanks = messages
        .as_array()
        .unwrap()
        .iter()
        .find(|m| m["source_id"] == "IN2")
        .unwrap();
    assert_eq!(thanks["content_attributes"]["in_reply_to"], reply.body["id"]);
    assert!(f.event_names().contains(&"message.updated".to_string()));
}

#[tokio::test]
async fn reactions_from_agents_and_contacts_are_kept_one_per_sender() {
    let f = Fixture::new().await;
    let (admin, session, incoming) = conversation_with_message(&f).await;
    let reacted = admin
        .post(
            &format!("/conversations/1/messages/{incoming}/reactions"),
            json!({ "emoji": "👍" }),
        )
        .await;
    assert_eq!(reacted.status, 200);
    assert_eq!(f.wa.actions(), vec![format!("react {JID} IN1 👍")]);
    admin
        .post(
            &format!("/conversations/1/messages/{incoming}/reactions"),
            json!({ "emoji": "❤️" }),
        )
        .await;
    f.app.sink.reaction(&session, JID, false, "IN1", "😀");
    let message = admin.get("/conversations/1/messages").await.body[0].clone();
    let reactions: Vec<(Value, Value)> = message["content_attributes"]["reactions"]
        .as_array()
        .unwrap()
        .iter()
        .map(|r| (r["emoji"].clone(), r["sender_type"].clone()))
        .collect();
    assert_eq!(
        reactions,
        vec![(json!("❤️"), json!("user")), (json!("😀"), json!("contact"))]
    );
    f.app.sink.reaction(&session, JID, false, "IN1", "");
    let removed = admin.get("/conversations/1/messages").await.body[0]["content_attributes"]["reactions"].clone();
    assert_eq!(removed.as_array().unwrap().len(), 1);
    let bad = admin
        .post(
            &format!("/conversations/1/messages/{incoming}/reactions"),
            json!({ "emoji": "123456789" }),
        )
        .await;
    assert_eq!(bad.status, 400);
    assert_eq!(
        admin
            .post("/conversations/1/messages/999/reactions", json!({ "emoji": "x" }))
            .await
            .status,
        404
    );
}

#[tokio::test]
async fn deleting_and_editing_messages() {
    let f = Fixture::new().await;
    let (admin, session, incoming) = conversation_with_message(&f).await;
    let sent = admin
        .post("/conversations/1/messages", json!({ "content": "errado" }))
        .await
        .body;
    let id = sent["id"].as_i64().unwrap();
    let deleted = admin.del(&format!("/conversations/1/messages/{id}"), None).await;
    assert_eq!(deleted.status, 200);
    assert_eq!(
        (
            deleted.body["content"].clone(),
            deleted.body["content_attributes"]["deleted"].clone()
        ),
        (Value::Null, json!(true))
    );
    let source = sent["source_id"].as_str().unwrap();
    assert!(f.wa.actions().contains(&format!("revoke {JID} {source}")));
    let theirs = admin.del(&format!("/conversations/1/messages/{incoming}"), None).await;
    assert_eq!(theirs.status, 422, "contact messages cannot be deleted by agents");
    let note = admin
        .post(
            "/conversations/1/messages",
            json!({ "content": "nota", "private": true }),
        )
        .await
        .body;
    let before = f.wa.actions().len();
    admin
        .del(&format!("/conversations/1/messages/{}", note["id"]), None)
        .await;
    assert_eq!(f.wa.actions().len(), before, "notes are deleted locally only");

    f.app.sink.edited(&session, "IN1", "Qual o prazo de entrega?");
    f.app.sink.revoked(&session, "missing");
    let message = admin.get("/conversations/1/messages").await.body[0].clone();
    assert_eq!(message["content"], "Qual o prazo de entrega?");
    assert_eq!(message["content_attributes"]["edited"], true);
    assert_eq!(message["content_attributes"]["previous_content"], "Qual o prazo?");
    f.app.sink.revoked(&session, "IN1");
    let message = admin.get("/conversations/1/messages").await.body[0].clone();
    assert_eq!(
        (
            message["content"].clone(),
            message["content_attributes"]["deleted"].clone()
        ),
        (Value::Null, json!(true))
    );
}

#[tokio::test]
async fn failed_messages_can_be_retried_with_the_same_whatsapp_id() {
    let f = Fixture::new().await;
    let (admin, _session, _incoming) = conversation_with_message(&f).await;
    f.wa.fail_with(Some("Sessão desconectada"));
    let failed = admin
        .post("/conversations/1/messages", json!({ "content": "olá" }))
        .await
        .body;
    assert_eq!(failed["status"], "failed");
    let id = failed["id"].as_i64().unwrap();
    f.wa.fail_with(None);
    let retried = admin
        .post(&format!("/conversations/1/messages/{id}/retry"), json!({}))
        .await;
    assert_eq!(retried.status, 200);
    assert_eq!(retried.body["status"], "sent");
    assert!(retried.body["content_attributes"].get("external_error").is_none());
    assert_eq!(
        f.wa.sent().last().unwrap().message_id.as_deref(),
        failed["source_id"].as_str()
    );
    let again = admin
        .post(&format!("/conversations/1/messages/{id}/retry"), json!({}))
        .await;
    assert_eq!(again.status, 422);
}

#[tokio::test]
async fn typing_is_shown_both_ways_and_read_receipts_are_sent() {
    let f = Fixture::new().await;
    let (admin, session, _incoming) = conversation_with_message(&f).await;
    let on = admin
        .post(
            "/conversations/1/toggle_typing_status",
            json!({ "typing_status": "on" }),
        )
        .await;
    assert_eq!(on.status, 200);
    admin
        .post(
            "/conversations/1/toggle_typing_status",
            json!({ "typing_status": "off", "is_private": true }),
        )
        .await;
    assert_eq!(
        f.wa.actions(),
        vec![format!("typing {JID} Composing")],
        "private notes do not show typing to the contact"
    );
    let invalid = admin
        .post("/conversations/1/toggle_typing_status", json!({ "typing_status": "x" }))
        .await;
    assert_eq!(invalid.status, 400);
    f.app.sink.typing(&session, JID, Typing::Recording);
    let typing: Vec<Value> = f
        .events
        .lock()
        .iter()
        .filter(|e| e.event == "conversation.typing_on")
        .map(|e| e.data.clone())
        .collect();
    assert_eq!(typing.last().unwrap()["user"]["type"], "contact");
    assert_eq!(typing.last().unwrap()["recording"], true);
    assert!(f.event_names().contains(&"conversation.typing_off".to_string()));
    admin.post("/conversations/1/update_last_seen", json!({})).await;
    for _ in 0..20 {
        if f.wa.actions().iter().any(|a| a.starts_with("read")) {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
    assert!(f.wa.actions().contains(&format!("read {JID} IN1")));
}
