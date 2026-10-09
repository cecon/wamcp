//! Helpdesk API: replies, private notes, delivery failures and the conversation lifecycle.
mod common;

use common::{Fixture, Incoming};
use serde_json::{json, Value};

#[tokio::test]
async fn replies_go_to_whatsapp_notes_do_not_and_failures_are_recorded() {
    let f = Fixture::new().await;
    let s = f.session("Suporte");
    let admin = f.bootstrap().await;
    let maria = f.agent(&admin, "maria@example.com", "agent", true).await;
    f.incoming(&s.id, Incoming::default());
    let reply = maria
        .post(
            "/conversations/1/messages",
            json!({ "content": "Oi, como posso ajudar?" }),
        )
        .await;
    assert_eq!(reply.status, 201);
    assert_eq!(reply.body["status"], "sent");
    let sent = f.wa.sent();
    assert_eq!(sent.len(), 1);
    assert_eq!(
        (sent[0].session_id.as_str(), sent[0].jid.as_str()),
        (s.id.as_str(), "5511988887777@s.whatsapp.net")
    );
    assert_eq!(
        (sent[0].text.as_str(), sent[0].message_id.as_deref()),
        ("Oi, como posso ajudar?", Some("OUT1"))
    );
    // WhatsApp echoes our own message back; it must not be duplicated.
    f.incoming(
        &s.id,
        Incoming {
            id: "OUT1",
            body: "Oi, como posso ajudar?",
            from_me: true,
            ..Default::default()
        },
    );

    let note = maria
        .post(
            "/conversations/1/messages",
            json!({ "content": "cliente VIP", "private": true }),
        )
        .await;
    assert_eq!(note.body["private"], true);
    assert_eq!(f.wa.sent().len(), 1);

    f.wa.fail_with(Some("Sessão desconectada"));
    let failed = maria
        .post("/conversations/1/messages", json!({ "content": "teste" }))
        .await;
    assert_eq!(failed.body["status"], "failed");
    assert_eq!(
        failed.body["content_attributes"]["external_error"],
        "Sessão desconectada"
    );

    let conversation = maria.get("/conversations/1").await.body;
    assert_eq!(
        conversation["assignee_id"].as_i64(),
        Some(maria.id()),
        "replying agent takes the conversation"
    );
    assert!(conversation["first_reply_at"].is_number());
    let messages = maria.get("/conversations/1/messages").await.body;
    let outgoing = messages
        .as_array()
        .unwrap()
        .iter()
        .filter(|m| m["message_type"] == "outgoing")
        .count();
    assert_eq!(outgoing, 3);

    let helpdesk = &f.app.state.support().helpdesk;
    helpdesk.receipt(&s.id, "OUT1", "read").unwrap();
    helpdesk.receipt(&s.id, "OUT1", "delivered").unwrap();
    let messages = maria.get("/conversations/1/messages").await.body;
    let echoed = messages
        .as_array()
        .unwrap()
        .iter()
        .find(|m| m["source_id"] == "OUT1")
        .cloned()
        .unwrap();
    assert_eq!(echoed["status"], "read");
    assert_eq!(
        maria
            .post("/conversations/1/messages", json!({ "content": "   " }))
            .await
            .status,
        400
    );
}

#[tokio::test]
async fn status_changes_write_activities_and_resolved_conversations_reopen() {
    let f = Fixture::new().await;
    let s = f.session("Suporte");
    let admin = f.bootstrap().await;
    f.incoming(&s.id, Incoming::default());
    let resolved = admin
        .post("/conversations/1/toggle_status", json!({ "status": "resolved" }))
        .await;
    assert_eq!(resolved.body["status"], "resolved");
    f.incoming(
        &s.id,
        Incoming {
            id: "IN2",
            body: "voltei",
            ..Default::default()
        },
    );
    assert_eq!(admin.get("/conversations/1").await.body["status"], "open");

    let inbox = resolved.body["inbox_id"].as_i64().unwrap();
    admin
        .patch(
            &format!("/inboxes/{inbox}"),
            json!({ "lock_to_single_conversation": false }),
        )
        .await;
    admin
        .post("/conversations/1/toggle_status", json!({ "status": "resolved" }))
        .await;
    f.incoming(
        &s.id,
        Incoming {
            id: "IN3",
            body: "outra dúvida",
            ..Default::default()
        },
    );
    assert_eq!(
        admin
            .get("/conversations?status=all")
            .await
            .body
            .as_array()
            .map(Vec::len),
        Some(2)
    );

    let until = f.now() + 3600;
    admin
        .post(
            "/conversations/2/toggle_status",
            json!({ "status": "snoozed", "snoozed_until": until }),
        )
        .await;
    let past = admin
        .post(
            "/conversations/2/toggle_status",
            json!({ "status": "snoozed", "snoozed_until": f.now() - 1 }),
        )
        .await;
    assert_eq!(past.status, 400);
    f.tick(3601);
    f.app.state.support().helpdesk.wake_snoozed().unwrap();
    assert_eq!(admin.get("/conversations/2").await.body["status"], "open");

    let messages = admin.get("/conversations/1/messages").await.body;
    let activities: Vec<&Value> = messages
        .as_array()
        .unwrap()
        .iter()
        .filter(|m| m["message_type"] == "activity")
        .map(|m| &m["content"])
        .collect();
    assert_eq!(
        activities,
        vec!["Admin resolveu a conversa", "Admin resolveu a conversa"]
    );
}
