//! Chat list power features: sorting, views, unread, mute, participants, transcript, deletion
//! and bulk actions.
mod common;

use common::{Fixture, Incoming};
use serde_json::{json, Value};

fn displays(list: &Value) -> Vec<i64> {
    list.as_array()
        .unwrap()
        .iter()
        .filter_map(|c| c["display_id"].as_i64())
        .collect()
}

async fn three_conversations(f: &Fixture) -> (common::Agent, String) {
    let session = f.session("Suporte");
    let admin = f.bootstrap().await;
    for (n, jid) in ["5511900000001", "5511900000002", "5511900000003"].iter().enumerate() {
        let (id, jid) = (format!("IN{n}"), format!("{jid}@s.whatsapp.net"));
        f.tick(10);
        f.incoming(
            &session.id,
            Incoming {
                id: &id,
                jid: &jid,
                ..Default::default()
            },
        );
    }
    (admin, session.id)
}

#[tokio::test]
async fn lists_sort_and_filter_unattended_and_participating() {
    let f = Fixture::new().await;
    let (admin, _) = three_conversations(&f).await;
    assert_eq!(displays(&admin.get("/conversations").await.body), vec![3, 2, 1]);
    assert_eq!(
        displays(&admin.get("/conversations?sort_by=created_at_asc").await.body),
        vec![1, 2, 3]
    );
    admin
        .post("/conversations/2/toggle_priority", json!({ "priority": "urgent" }))
        .await;
    admin
        .post("/conversations/1/toggle_priority", json!({ "priority": "low" }))
        .await;
    assert_eq!(
        displays(&admin.get("/conversations?sort_by=priority_desc").await.body)[0],
        2
    );
    assert_eq!(admin.get("/conversations?sort_by=bogus").await.status, 400);
    admin
        .post("/conversations/3/messages", json!({ "content": "Oi" }))
        .await;
    let unattended = displays(&admin.get("/conversations?conversation_type=unattended").await.body);
    assert_eq!(
        unattended,
        vec![2, 1],
        "replied conversations leave the unattended view"
    );
    let mine = displays(&admin.get("/conversations?conversation_type=participating").await.body);
    assert_eq!(mine, vec![3]);
    assert!(admin
        .get("/conversations?conversation_type=mentions")
        .await
        .body
        .as_array()
        .unwrap()
        .is_empty());
    let waiting = displays(&admin.get("/conversations?sort_by=waiting_since_asc").await.body);
    assert_eq!(waiting[..2], [1, 2]);
}

#[tokio::test]
async fn mark_unread_restores_the_badge() {
    let f = Fixture::new().await;
    let (admin, _) = three_conversations(&f).await;
    admin.post("/conversations/1/update_last_seen", json!({})).await;
    assert_eq!(admin.get("/conversations/1").await.body["unread_count"], 0);
    let unread = admin.post("/conversations/1/unread", json!({})).await;
    assert_eq!(unread.status, 200);
    assert_eq!(admin.get("/conversations/1").await.body["unread_count"], 1);
}

#[tokio::test]
async fn muted_conversations_resolve_and_stay_quiet() {
    let f = Fixture::new().await;
    let session = f.session("Suporte");
    let admin = f.bootstrap().await;
    let maria = f.agent(&admin, "maria@example.com", "agent", true).await;
    f.incoming(&session.id, Incoming::default());
    admin
        .post("/conversations/1/assignments", json!({ "assignee_id": maria.id() }))
        .await;
    let muted = admin.post("/conversations/1/mute", json!({})).await.body;
    assert_eq!(
        (muted["status"].as_str(), muted["muted"].as_i64()),
        (Some("resolved"), Some(1))
    );
    let notes = maria.get("/notifications").await.body["items"]
        .as_array()
        .unwrap()
        .len();
    f.incoming(
        &session.id,
        Incoming {
            id: "IN2",
            body: "spam",
            ..Default::default()
        },
    );
    let conversation = admin.get("/conversations/1").await.body;
    assert_eq!(
        conversation["status"], "resolved",
        "a muted conversation does not reopen"
    );
    assert_eq!(
        admin
            .get("/conversations?status=all")
            .await
            .body
            .as_array()
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        maria.get("/notifications").await.body["items"]
            .as_array()
            .unwrap()
            .len(),
        notes
    );
    let unmuted = admin.post("/conversations/1/unmute", json!({})).await.body;
    assert_eq!(unmuted["muted"], 0);
    f.incoming(
        &session.id,
        Incoming {
            id: "IN3",
            body: "voltei",
            ..Default::default()
        },
    );
    assert_eq!(admin.get("/conversations/1").await.body["status"], "open");
    let activities: Vec<Value> = admin
        .get("/conversations/1/messages")
        .await
        .body
        .as_array()
        .unwrap()
        .iter()
        .filter(|m| m["message_type"] == "activity")
        .map(|m| m["content"].clone())
        .collect();
    assert!(activities.contains(&json!("Admin silenciou a conversa")));
}

#[tokio::test]
async fn participants_transcript_and_deletion() {
    let f = Fixture::new().await;
    let session = f.session("Suporte");
    let admin = f.bootstrap().await;
    let maria = f.agent(&admin, "maria@example.com", "agent", true).await;
    let outsider = f.agent(&admin, "fora@example.com", "agent", false).await;
    f.incoming(
        &session.id,
        Incoming {
            body: "Quero um orçamento",
            name: "João",
            ..Default::default()
        },
    );
    admin
        .post("/conversations/1/messages", json!({ "content": "Claro!" }))
        .await;
    admin
        .post(
            "/conversations/1/messages",
            json!({ "content": "nota interna", "private": true }),
        )
        .await;
    let set = admin
        .patch("/conversations/1/participants", json!({ "user_ids": [maria.id()] }))
        .await;
    let names: Vec<Value> = set.body.as_array().unwrap().iter().map(|u| u["name"].clone()).collect();
    assert_eq!(
        names,
        vec![json!("maria")],
        "admin replied but is replaced by the new list"
    );
    let denied = admin
        .patch("/conversations/1/participants", json!({ "user_ids": [outsider.id()] }))
        .await;
    assert_eq!(denied.status, 422);
    assert_eq!(
        maria
            .get("/conversations/1/participants")
            .await
            .body
            .as_array()
            .unwrap()
            .len(),
        1
    );
    let transcript = admin.get("/conversations/1/transcript").await;
    assert!(transcript
        .header("content-disposition")
        .unwrap()
        .contains("conversa-1.txt"));
    assert!(transcript.text.contains("João: Quero um orçamento") && transcript.text.contains("Admin: Claro!"));
    assert!(!transcript.text.contains("nota interna"));
    assert_eq!(maria.del("/conversations/1", None).await.status, 403);
    assert_eq!(admin.del("/conversations/1", None).await.status, 200);
    assert_eq!(admin.get("/conversations/1").await.status, 404);
    assert!(f.event_names().contains(&"conversation.deleted".to_string()));
}

#[tokio::test]
async fn bulk_actions_apply_to_each_conversation_and_report_failures() {
    let f = Fixture::new().await;
    let (admin, _) = three_conversations(&f).await;
    admin.post("/labels", json!({ "title": "vip" })).await;
    let body = json!({ "ids": [1, 2, 99], "fields": { "status": "resolved", "priority": "high" }, "labels": { "add": ["vip"] } });
    let result = admin.post("/bulk_actions", body).await;
    assert_eq!(result.status, 200);
    assert_eq!(result.body["updated"], json!([1, 2]));
    assert_eq!(result.body["failed"][0]["id"], 99);
    for display in [1, 2] {
        let c = admin.get(&format!("/conversations/{display}")).await.body;
        assert_eq!(
            (c["status"].as_str(), c["priority"].as_str(), c["labels"].clone()),
            (Some("resolved"), Some("high"), json!(["vip"]))
        );
    }
    let unlabel = admin
        .post("/bulk_actions", json!({ "ids": [1], "labels": { "remove": ["vip"] } }))
        .await;
    assert_eq!(unlabel.body["updated"], json!([1]));
    assert_eq!(admin.get("/conversations/1").await.body["labels"], json!([]));
    let snooze =
        json!({ "ids": [3], "fields": { "status": "snoozed", "snoozed_until": f.now() + 60, "assignee_id": null } });
    assert_eq!(admin.post("/bulk_actions", snooze).await.body["updated"], json!([3]));
    assert_eq!(admin.post("/bulk_actions", json!({ "ids": [1] })).await.status, 400);
    assert_eq!(
        admin
            .post("/bulk_actions", json!({ "ids": [], "fields": { "status": "open" } }))
            .await
            .status,
        400
    );
    assert_eq!(
        admin
            .post("/bulk_actions", json!({ "ids": [1], "fields": { "status": "x" } }))
            .await
            .status,
        400
    );
}
