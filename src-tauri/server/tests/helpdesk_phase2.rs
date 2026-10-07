//! Helpdesk phase 2: labels, canned responses, notifications and the event stream (the MCP bot
//! lives in `helpdesk_phase2_bot.rs`).
mod common;
mod helpdesk_support;

use common::http::request;
use common::{Fixture, Incoming};
use helpdesk_support::{agent, items};
use http_body_util::BodyExt;
use serde_json::{json, Value};
use std::time::Duration;
use tower::ServiceExt;

#[tokio::test]
async fn labels_are_admin_managed_replace_the_conversation_set_and_filter_the_list() {
    let f = Fixture::new().await;
    let s = f.session("Suporte");
    let admin = f.bootstrap().await;
    let inbox = admin.get("/inboxes").await.body[0]["id"].clone();
    let maria = agent(&f, &admin, "maria@example.com", json!([inbox])).await;
    assert_eq!(maria.post("/labels", json!({ "title": "vip" })).await.status, 403);
    let created = admin
        .post("/labels", json!({ "title": "Cliente VIP", "color": "#ff0000" }))
        .await;
    assert_eq!(created.body["title"], "cliente-vip");
    admin.post("/labels", json!({ "title": "financeiro" })).await;
    assert_eq!(
        admin.post("/labels", json!({ "title": "FINANCEIRO" })).await.status,
        409
    );

    f.incoming(
        &s.id,
        Incoming {
            id: "IN1",
            ..Default::default()
        },
    );
    f.incoming(
        &s.id,
        Incoming {
            id: "IN2",
            jid: "5511900000000@s.whatsapp.net",
            ..Default::default()
        },
    );
    let set = maria
        .post(
            "/conversations/1/labels",
            json!({ "labels": ["cliente-vip", "financeiro"] }),
        )
        .await;
    assert_eq!(set.body["labels"], json!(["cliente-vip", "financeiro"]));
    let missing = maria
        .post("/conversations/1/labels", json!({ "labels": ["nao-existe"] }))
        .await;
    assert_eq!(missing.status, 422);
    maria
        .post("/conversations/1/labels", json!({ "labels": ["financeiro"] }))
        .await;
    let filtered = maria.get("/conversations?label=financeiro").await.body;
    let ids: Vec<&Value> = items(&filtered).iter().map(|c| &c["display_id"]).collect();
    assert_eq!(ids, vec![&json!(1)]);
    let messages = maria.get("/conversations/1/messages").await.body;
    let activities: Vec<&Value> = items(&messages)
        .iter()
        .filter(|m| m["message_type"] == "activity")
        .map(|m| &m["content"])
        .collect();
    assert_eq!(
        activities,
        vec!["maria adicionou cliente-vip, financeiro", "maria removeu cliente-vip"]
    );
}

#[tokio::test]
async fn any_agent_creates_canned_responses_only_admins_delete_them() {
    let f = Fixture::new().await;
    let admin = f.bootstrap().await;
    let maria = agent(&f, &admin, "maria@example.com", json!([])).await;
    let created = maria
        .post(
            "/canned_responses",
            json!({ "short_code": "Saudacao", "content": "Olá! Como posso ajudar?" }),
        )
        .await;
    assert_eq!(created.body["short_code"], "saudacao");
    let duplicate = maria
        .post("/canned_responses", json!({ "short_code": "saudacao", "content": "x" }))
        .await;
    assert_eq!(duplicate.status, 409);
    assert_eq!(items(&maria.get("/canned_responses?q=ajudar").await.body).len(), 1);
    let path = format!("/canned_responses/{}", created.body["id"]);
    assert_eq!(maria.del(&path, None).await.status, 403);
    assert_eq!(admin.del(&path, None).await.status, 200);
}

#[tokio::test]
async fn notifications_follow_assignment_and_new_messages_on_assigned_conversations() {
    let f = Fixture::new().await;
    let s = f.session("Suporte");
    let admin = f.bootstrap().await;
    let inbox = admin.get("/inboxes").await.body[0]["id"].clone();
    let maria = agent(&f, &admin, "maria@example.com", json!([inbox])).await;
    f.incoming(
        &s.id,
        Incoming {
            id: "IN1",
            ..Default::default()
        },
    );
    let list = maria.get("/notifications").await.body;
    let kinds: Vec<&Value> = items(&list["items"]).iter().map(|n| &n["notification_type"]).collect();
    assert_eq!(kinds, vec!["conversation_creation"]);
    admin
        .post("/conversations/1/assignments", json!({ "assignee_id": maria.id() }))
        .await;
    f.incoming(
        &s.id,
        Incoming {
            id: "IN2",
            body: "ainda aí?",
            ..Default::default()
        },
    );
    let list = maria.get("/notifications").await.body;
    let kinds: Vec<Value> = items(&list["items"])
        .iter()
        .map(|n| json!([n["notification_type"], n["display_id"]]))
        .collect();
    assert_eq!(
        kinds,
        vec![
            json!(["assigned_conversation_new_message", 1]),
            json!(["conversation_assignment", 1]),
            json!(["conversation_creation", 1]),
        ]
    );
    assert_eq!(list["items"][1]["actor_name"], "Admin");
    assert_eq!(list["unread"], 3);
    let first = format!("/notifications/{}", list["items"][0]["id"]);
    assert_eq!(maria.patch(&first, json!({})).await.body, json!({ "unread": 2 }));
    maria.post("/notifications/read_all", json!({})).await;
    assert_eq!(maria.get("/notifications/unread_count").await.body["unread"], 0);
    let paged = items(&admin.get("/notifications").await.body["items"]).len();
    assert_eq!(paged, 0, "admins are not paged for new chats");
}

#[tokio::test]
async fn the_event_stream_only_carries_events_from_the_agent_inboxes() {
    let f = Fixture::new().await;
    let (a, b) = (f.session("A"), f.session("B"));
    let admin = f.bootstrap().await;
    let inboxes = admin.get("/inboxes").await.body;
    let inbox_a = items(&inboxes).iter().find(|i| i["name"] == "A").expect("inbox A")["id"].clone();
    let maria = agent(&f, &admin, "maria@example.com", json!([inbox_a])).await;
    let req = request("GET", "/api/v1/events", None, &[("cookie", maria.cookie.as_str())]);
    let response = f.app.public_router().oneshot(req).await.expect("infallible router");
    let content_type = response
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .map(String::from);
    assert_eq!(content_type.as_deref(), Some("text/event-stream; charset=utf-8"));
    let mut body = response.into_body();
    f.incoming(
        &b.id,
        Incoming {
            id: "B1",
            jid: "5511900000000@s.whatsapp.net",
            body: "segredo de B",
            ..Default::default()
        },
    );
    f.incoming(
        &a.id,
        Incoming {
            id: "A1",
            body: "mensagem de A",
            ..Default::default()
        },
    );
    let mut text = String::new();
    while !text.contains("mensagem de A") {
        let frame = tokio::time::timeout(Duration::from_secs(5), body.frame())
            .await
            .expect("stream stalled");
        let frame = frame.expect("stream ended").expect("frame");
        if let Some(data) = frame.data_ref() {
            text.push_str(&String::from_utf8_lossy(data));
        }
    }
    assert!(text.contains("event: conversation.created"), "{text}");
    assert!(!text.contains("segredo de B"), "{text}");
}
