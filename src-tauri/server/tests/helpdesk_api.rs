//! Helpdesk API: bootstrap, auth guards, ingestion, visibility, replies, lifecycle and assignment.
mod common;

use common::{Fixture, Incoming, PASSWORD};
use serde_json::{json, Value};

#[tokio::test]
async fn bootstrap_creates_the_first_admin_once_and_login_issues_a_secure_cookie() {
    let f = Fixture::new().await;
    assert_eq!(f.admin("GET", "/api/helpdesk/status", None).await.body["needsBootstrap"], true);
    let admin = f.bootstrap().await;
    assert_eq!(admin.user["role"], "administrator");
    let again = json!({ "name": "X", "email": "x@example.com", "password": PASSWORD });
    assert_eq!(f.admin("POST", "/api/helpdesk/bootstrap", Some(again)).await.status, 409);
    let login = json!({ "email": "ADMIN@example.com", "password": PASSWORD });
    let reply = f.api("POST", "/auth/login", Some(login), &[]).await;
    assert!(reply.header("set-cookie").unwrap_or_default().contains("HttpOnly; Secure; SameSite=Strict"));
    assert_eq!(f.login("admin@example.com", "senha-errada-000").await.err(), Some(401));
    assert_eq!(f.login("ninguem@example.com", PASSWORD).await.err(), Some(401));
    assert_eq!(f.admin("GET", "/api/helpdesk/status", None).await.body["needsBootstrap"], false);
}

#[tokio::test]
async fn api_rejects_missing_sessions_missing_csrf_and_foreign_origins() {
    let f = Fixture::new().await;
    let admin = f.bootstrap().await;
    assert_eq!(f.api("GET", "/conversations", None, &[]).await.status, 401);
    let no_csrf = f.api("POST", "/teams", Some(json!({ "name": "Vendas" })), &[("cookie", &admin.cookie)]).await;
    assert_eq!(no_csrf.status, 403);
    let foreign = f.api("GET", "/auth/me", None, &[("cookie", &admin.cookie), ("origin", "https://evil.example")]).await;
    assert_eq!(foreign.status, 403);
    let token = admin.post("/profile/access_token", json!({})).await.body["token"].as_str().unwrap_or_default().to_string();
    let via_token = f.api("GET", "/auth/me", None, &[("api_access_token", &token)]).await;
    assert_eq!(via_token.body["user"]["email"], "admin@example.com");
    assert_eq!(f.api("GET", "/auth/me", None, &[("api_access_token", "wahd_x")]).await.status, 401);
    admin.post("/auth/logout", json!({})).await;
    assert_eq!(admin.get("/auth/me").await.status, 401);
}

#[tokio::test]
async fn existing_sessions_become_inboxes_and_live_messages_open_conversations() {
    let f = Fixture::new().await;
    let session = f.session("Suporte");
    let admin = f.bootstrap().await;
    let inboxes = admin.get("/inboxes").await.body;
    assert_eq!(inboxes[0]["name"], "Suporte");
    assert_eq!(inboxes[0]["session_id"], session.id.as_str());

    f.incoming(&session.id, Incoming { id: "IN1", body: "Preciso de ajuda", name: "João", ..Default::default() });
    f.incoming(&session.id, Incoming { id: "IN1", body: "Preciso de ajuda", ..Default::default() });
    f.incoming(&session.id, Incoming { id: "IN2", body: "Alô?", ..Default::default() });
    f.incoming(&session.id, Incoming { id: "G1", jid: "120363@g.us", body: "grupo", ..Default::default() });

    let list = admin.get("/conversations").await.body;
    assert_eq!(list.as_array().map(Vec::len), Some(1));
    assert_eq!(list[0]["display_id"], 1);
    assert_eq!(list[0]["contact_name"], "João");
    assert_eq!(list[0]["contact_phone"], "+5511988887777");
    assert_eq!(list[0]["unread_count"], 2);
    let messages = admin.get("/conversations/1/messages").await.body;
    let summary: Vec<Value> = messages.as_array().unwrap().iter().map(|m| json!([m["message_type"], m["content"], m["sender_name"]])).collect();
    assert_eq!(summary, vec![json!(["incoming", "Preciso de ajuda", "João"]), json!(["incoming", "Alô?", "João"])]);
    assert!(f.event_names().contains(&"conversation.created".to_string()));
    admin.post("/conversations/1/update_last_seen", json!({})).await;
    assert_eq!(admin.get("/conversations/1").await.body["unread_count"], 0);
    let history = admin.get("/conversations/1/history").await.body;
    assert_eq!(history.as_array().map(Vec::len), Some(2));
}

#[tokio::test]
async fn agents_see_only_conversations_from_their_inboxes() {
    let f = Fixture::new().await;
    let (a, b) = (f.session("A"), f.session("B"));
    let admin = f.bootstrap().await;
    let maria = f.agent(&admin, "maria@example.com", "agent", true).await;
    f.incoming(&a.id, Incoming { id: "A1", ..Default::default() });
    f.incoming(&b.id, Incoming { id: "B1", jid: "5511900000000@s.whatsapp.net", ..Default::default() });
    let mine = maria.get("/conversations").await.body;
    assert_eq!(mine.as_array().map(Vec::len), Some(1));
    assert_eq!(mine[0]["inbox_name"], "A");
    let other = admin.get("/conversations?q=900000").await.body[0]["display_id"].as_i64().unwrap();
    assert_eq!(maria.get(&format!("/conversations/{other}")).await.status, 404);
    let denied = maria.post("/agents", json!({ "name": "x", "email": "x@x.com", "password": PASSWORD })).await;
    assert_eq!(denied.status, 403);
    assert_eq!(maria.get("/inboxes").await.body.as_array().map(Vec::len), Some(1));
}

#[tokio::test]
async fn replies_go_to_whatsapp_notes_do_not_and_failures_are_recorded() {
    let f = Fixture::new().await;
    let s = f.session("Suporte");
    let admin = f.bootstrap().await;
    let maria = f.agent(&admin, "maria@example.com", "agent", true).await;
    f.incoming(&s.id, Incoming::default());
    let reply = maria.post("/conversations/1/messages", json!({ "content": "Oi, como posso ajudar?" })).await;
    assert_eq!(reply.status, 201);
    assert_eq!(reply.body["status"], "sent");
    let sent = f.wa.sent();
    assert_eq!(sent.len(), 1);
    assert_eq!((sent[0].session_id.as_str(), sent[0].jid.as_str()), (s.id.as_str(), "5511988887777@s.whatsapp.net"));
    assert_eq!((sent[0].text.as_str(), sent[0].message_id.as_deref()), ("Oi, como posso ajudar?", Some("OUT1")));
    // WhatsApp echoes our own message back; it must not be duplicated.
    f.incoming(&s.id, Incoming { id: "OUT1", body: "Oi, como posso ajudar?", from_me: true, ..Default::default() });

    let note = maria.post("/conversations/1/messages", json!({ "content": "cliente VIP", "private": true })).await;
    assert_eq!(note.body["private"], true);
    assert_eq!(f.wa.sent().len(), 1);

    f.wa.fail_with(Some("Sessão desconectada"));
    let failed = maria.post("/conversations/1/messages", json!({ "content": "teste" })).await;
    assert_eq!(failed.body["status"], "failed");
    assert_eq!(failed.body["content_attributes"]["external_error"], "Sessão desconectada");

    let conversation = maria.get("/conversations/1").await.body;
    assert_eq!(conversation["assignee_id"].as_i64(), Some(maria.id()), "replying agent takes the conversation");
    assert!(conversation["first_reply_at"].is_number());
    let messages = maria.get("/conversations/1/messages").await.body;
    let outgoing = messages.as_array().unwrap().iter().filter(|m| m["message_type"] == "outgoing").count();
    assert_eq!(outgoing, 3);

    let helpdesk = &f.app.state.support().helpdesk;
    helpdesk.receipt(&s.id, "OUT1", "read").unwrap();
    helpdesk.receipt(&s.id, "OUT1", "delivered").unwrap();
    let messages = maria.get("/conversations/1/messages").await.body;
    let echoed = messages.as_array().unwrap().iter().find(|m| m["source_id"] == "OUT1").cloned().unwrap();
    assert_eq!(echoed["status"], "read");
    assert_eq!(maria.post("/conversations/1/messages", json!({ "content": "   " })).await.status, 400);
}

#[tokio::test]
async fn status_changes_write_activities_and_resolved_conversations_reopen() {
    let f = Fixture::new().await;
    let s = f.session("Suporte");
    let admin = f.bootstrap().await;
    f.incoming(&s.id, Incoming::default());
    let resolved = admin.post("/conversations/1/toggle_status", json!({ "status": "resolved" })).await;
    assert_eq!(resolved.body["status"], "resolved");
    f.incoming(&s.id, Incoming { id: "IN2", body: "voltei", ..Default::default() });
    assert_eq!(admin.get("/conversations/1").await.body["status"], "open");

    let inbox = resolved.body["inbox_id"].as_i64().unwrap();
    admin.patch(&format!("/inboxes/{inbox}"), json!({ "lock_to_single_conversation": false })).await;
    admin.post("/conversations/1/toggle_status", json!({ "status": "resolved" })).await;
    f.incoming(&s.id, Incoming { id: "IN3", body: "outra dúvida", ..Default::default() });
    assert_eq!(admin.get("/conversations?status=all").await.body.as_array().map(Vec::len), Some(2));

    let until = f.now() + 3600;
    admin.post("/conversations/2/toggle_status", json!({ "status": "snoozed", "snoozed_until": until })).await;
    let past = admin.post("/conversations/2/toggle_status", json!({ "status": "snoozed", "snoozed_until": f.now() - 1 })).await;
    assert_eq!(past.status, 400);
    f.tick(3601);
    f.app.state.support().helpdesk.wake_snoozed().unwrap();
    assert_eq!(admin.get("/conversations/2").await.body["status"], "open");

    let messages = admin.get("/conversations/1/messages").await.body;
    let activities: Vec<&Value> = messages.as_array().unwrap().iter().filter(|m| m["message_type"] == "activity").map(|m| &m["content"]).collect();
    assert_eq!(activities, vec!["Admin resolveu a conversa", "Admin resolveu a conversa"]);
}

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
        f.incoming(&s.id, Incoming { id: &id, jid: &jid, ..Default::default() });
    }
    let list = admin.get("/conversations?status=all").await.body;
    let mut assignees: Vec<i64> = list.as_array().unwrap().iter().filter_map(|c| c["assignee_id"].as_i64()).collect();
    assignees.sort_unstable();
    let mut expected = vec![maria.id(), maria.id(), ana.id()];
    expected.sort_unstable();
    assert_eq!(assignees, expected);

    let denied = admin.post("/conversations/1/assignments", json!({ "assignee_id": outsider.id() })).await;
    assert_eq!(denied.status, 422);
    let team = admin.post("/teams", json!({ "name": "Financeiro" })).await.body;
    let team_id = team["id"].as_i64().unwrap();
    admin.post(&format!("/teams/{team_id}/members"), json!({ "user_ids": [ana.id()] })).await;
    let assigned = admin.post("/conversations/1/assignments", json!({ "assignee_id": null, "team_id": team_id })).await;
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
    assert_eq!(admin.patch(&format!("/agents/{}", admin.id()), json!({ "role": "agent" })).await.status, 409);
    assert_eq!(admin.del(&format!("/agents/{}", admin.id()), None).await.status, 409);
    let maria = f.agent(&admin, "maria@example.com", "agent", false).await;
    assert_eq!(admin.patch(&format!("/agents/{}", maria.id()), json!({ "active": false })).await.status, 200);
    assert_eq!(maria.get("/auth/me").await.status, 401, "deactivation ends active sessions");
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
