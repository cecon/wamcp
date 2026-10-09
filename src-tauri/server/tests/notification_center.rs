//! Mentions in private notes, participant alerts, notification preferences, snooze and delete.
mod common;

use common::{Agent, Fixture, Incoming};
use serde_json::{json, Value};

async fn items(agent: &Agent) -> Vec<Value> {
    agent.get("/notifications").await.body["items"]
        .as_array()
        .unwrap()
        .clone()
}

async fn kinds(agent: &Agent) -> Vec<String> {
    items(agent)
        .await
        .iter()
        .filter_map(|n| n["notification_type"].as_str().map(String::from))
        .collect()
}

#[tokio::test]
async fn mentions_and_participants_are_notified_by_preference() {
    let f = Fixture::new().await;
    let session = f.session("Suporte");
    let admin = f.bootstrap().await;
    let maria = f.agent(&admin, "maria@example.com", "agent", true).await;
    let jose = f.agent(&admin, "jose@example.com", "agent", true).await;
    let outsider = f.agent(&admin, "fora@example.com", "agent", false).await;
    f.incoming(&session.id, Incoming::default());
    admin
        .post("/conversations/1/assignments", json!({ "assignee_id": jose.id() }))
        .await;
    let note = format!(
        "Veja [@maria](mention://user/{m}/maria), [@fora](mention://user/{o}/fora), [@eu](mention://user/{a}/Admin) e de novo mention://user/{m}/maria",
        m = maria.id(),
        o = outsider.id(),
        a = admin.id()
    );
    admin
        .post("/conversations/1/messages", json!({ "content": note, "private": true }))
        .await;
    assert_eq!(
        kinds(&maria).await,
        vec!["conversation_mention", "conversation_creation"]
    );
    assert_eq!(items(&maria).await[0]["actor_name"], "Admin");
    assert!(kinds(&outsider).await.is_empty(), "no access to the inbox");
    assert!(kinds(&admin).await.iter().all(|k| k != "conversation_mention"));
    let mentioned = maria.get("/conversations?conversation_type=mentions").await.body;
    assert_eq!(mentioned.as_array().unwrap().len(), 1);
    let participants = maria.get("/conversations/1/participants").await.body;
    assert!(participants.as_array().unwrap().iter().any(|u| u["id"] == maria.id()));
    let public = format!("oi mention://user/{}/maria", maria.id());
    admin
        .post("/conversations/1/messages", json!({ "content": public }))
        .await;
    assert_eq!(kinds(&maria).await.len(), 2, "public messages do not mention");

    f.incoming(
        &session.id,
        Incoming {
            id: "IN2",
            body: "Alguém?",
            ..Default::default()
        },
    );
    assert_eq!(kinds(&jose).await[0], "assigned_conversation_new_message");
    assert_eq!(kinds(&maria).await[0], "participating_conversation_new_message");

    let off = maria
        .patch(
            "/notification_settings",
            json!({ "flags": { "participating_conversation_new_message": false } }),
        )
        .await;
    assert_eq!(off.body["flags"]["participating_conversation_new_message"], false);
    assert_eq!(off.body["flags"]["conversation_mention"], true);
    let bad = maria
        .patch("/notification_settings", json!({ "flags": { "bogus": true } }))
        .await;
    assert_eq!(bad.status, 400);
    let not_bool = json!({ "flags": { "conversation_mention": "sim" } });
    assert_eq!(maria.patch("/notification_settings", not_bool).await.status, 400);
    f.incoming(
        &session.id,
        Incoming {
            id: "IN3",
            body: "Oi?",
            ..Default::default()
        },
    );
    assert_eq!(kinds(&maria).await.len(), 3, "turned off");
    assert_eq!(maria.get("/notification_settings").await.body, off.body);
}

#[tokio::test]
async fn notifications_can_be_snoozed_marked_unread_and_deleted() {
    let f = Fixture::new().await;
    let session = f.session("Suporte");
    let admin = f.bootstrap().await;
    let maria = f.agent(&admin, "maria@example.com", "agent", true).await;
    f.incoming(&session.id, Incoming::default());
    f.incoming(
        &session.id,
        Incoming {
            id: "IN2",
            jid: "5511900000002@s.whatsapp.net",
            ..Default::default()
        },
    );
    let list = items(&maria).await;
    assert_eq!(list.len(), 2);
    let (first, second) = (list[0]["id"].as_i64().unwrap(), list[1]["id"].as_i64().unwrap());
    let path = |id: i64, action: &str| format!("/notifications/{id}{action}");
    let until = f.now() + 3600;
    let snoozed = maria
        .post(&path(first, "/snooze"), json!({ "snoozed_until": until }))
        .await;
    assert_eq!(snoozed.body["unread"], 1);
    assert_eq!(items(&maria).await.len(), 1);
    assert_eq!(
        maria
            .post(&path(first, "/snooze"), json!({ "snoozed_until": f.now() }))
            .await
            .status,
        400
    );
    assert_eq!(
        admin
            .post(&path(first, "/snooze"), json!({ "snoozed_until": until }))
            .await
            .status,
        404
    );
    f.tick(3601);
    assert_eq!(maria.get("/notifications/unread_count").await.body["unread"], 2);
    assert_eq!(items(&maria).await[0]["snoozed_until"], until);

    maria.patch(&path(second, ""), json!({})).await;
    assert_eq!(maria.get("/notifications/unread_count").await.body["unread"], 1);
    let unread = maria.post(&path(second, "/unread"), json!({})).await;
    assert_eq!(unread.body["unread"], 2);
    assert_eq!(admin.post(&path(second, "/unread"), json!({})).await.status, 404);
    assert_eq!(maria.del(&path(second, ""), None).await.body["unread"], 1);
    assert_eq!(maria.del(&path(second, ""), None).await.status, 404);
    assert_eq!(
        maria.post("/notifications/destroy_all", json!({})).await.body["unread"],
        0
    );
    assert!(items(&maria).await.is_empty());
}
