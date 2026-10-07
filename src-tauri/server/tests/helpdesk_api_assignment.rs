//! Helpdesk API: assignment, administrator safeguards and the legacy sessions migration.
mod common;

use common::{Fixture, Incoming};
use serde_json::{json, Value};

#[tokio::test]
async fn assignment_validates_membership_and_round_robin_spreads_conversations() {
    let f = Fixture::new().await;
    let s = f.session("Suporte");
    let admin = f.bootstrap().await;
    admin.patch("/profile", json!({ "availability": "busy" })).await;
    let maria = f.agent(&admin, "maria@example.com", "agent", true).await;
    let ana = f.agent(&admin, "ana@example.com", "agent", true).await;
    let outsider = f.agent(&admin, "fora@example.com", "agent", false).await;
    maria.patch("/profile", json!({ "availability": "online" })).await;
    ana.patch("/profile", json!({ "availability": "online" })).await;

    for (n, jid) in ["5511900000001", "5511900000002", "5511900000003"].iter().enumerate() {
        let (id, jid) = (format!("IN{n}"), format!("{jid}@s.whatsapp.net"));
        f.incoming(
            &s.id,
            Incoming {
                id: &id,
                jid: &jid,
                ..Default::default()
            },
        );
    }
    let list = admin.get("/conversations?status=all").await.body;
    let mut assignees: Vec<i64> = list
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|c| c["assignee_id"].as_i64())
        .collect();
    assignees.sort_unstable();
    let mut expected = vec![maria.id(), maria.id(), ana.id()];
    expected.sort_unstable();
    assert_eq!(assignees, expected);

    let denied = admin
        .post("/conversations/1/assignments", json!({ "assignee_id": outsider.id() }))
        .await;
    assert_eq!(denied.status, 422);
    let team = admin.post("/teams", json!({ "name": "Financeiro" })).await.body;
    let team_id = team["id"].as_i64().unwrap();
    admin
        .post(&format!("/teams/{team_id}/members"), json!({ "user_ids": [ana.id()] }))
        .await;
    let assigned = admin
        .post(
            "/conversations/1/assignments",
            json!({ "assignee_id": null, "team_id": team_id }),
        )
        .await;
    assert_eq!(assigned.body["team_name"], "Financeiro");
    assert_eq!(assigned.body["assignee_id"], Value::Null);
    let meta = maria.get("/conversations/meta?status=all").await.body;
    let mut keys: Vec<&String> = meta.as_object().unwrap().keys().collect();
    keys.sort();
    assert_eq!(keys, vec!["all", "mine", "unassigned"]);
    assert_eq!(admin.post("/conversations/1/assignments", json!({})).await.status, 400);
}

#[tokio::test]
async fn the_last_active_administrator_cannot_be_removed_or_demoted() {
    let f = Fixture::new().await;
    let admin = f.bootstrap().await;
    assert_eq!(
        admin
            .patch(&format!("/agents/{}", admin.id()), json!({ "role": "agent" }))
            .await
            .status,
        409
    );
    assert_eq!(admin.del(&format!("/agents/{}", admin.id()), None).await.status, 409);
    let maria = f.agent(&admin, "maria@example.com", "agent", false).await;
    assert_eq!(
        admin
            .patch(&format!("/agents/{}", maria.id()), json!({ "active": false }))
            .await
            .status,
        200
    );
    assert_eq!(
        maria.get("/auth/me").await.status,
        401,
        "deactivation ends active sessions"
    );
    assert_eq!(admin.del(&format!("/agents/{}", maria.id()), None).await.status, 200);
    assert_eq!(admin.del("/agents/999", None).await.status, 404);
}

#[tokio::test]
async fn migration_turns_sessions_from_older_versions_into_inboxes() {
    let f = Fixture::with_dir(|dir| {
        let db = rusqlite::Connection::open(dir.join("wamcp.sqlite")).unwrap();
        db.execute_batch(
            "CREATE TABLE sessions(id TEXT PRIMARY KEY,name TEXT NOT NULL,phone TEXT,status TEXT NOT NULL DEFAULT 'disconnected',created TEXT NOT NULL);
             INSERT INTO sessions VALUES('legacy','Antiga',NULL,'disconnected','2026-01-01T00:00:00Z');",
        )
        .unwrap();
    })
    .await;
    let admin = f.bootstrap().await;
    let inboxes = admin.get("/inboxes").await.body;
    assert_eq!(inboxes[0]["name"], "Antiga");
    assert_eq!(inboxes[0]["session_id"], "legacy");
}
