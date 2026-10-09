//! Helpdesk API: bootstrap, auth guards, ingestion and visibility.
mod common;

use common::{Fixture, Incoming, PASSWORD};
use serde_json::{json, Value};

#[tokio::test]
async fn bootstrap_creates_the_first_admin_once_and_login_issues_a_secure_cookie() {
    let f = Fixture::new().await;
    assert_eq!(
        f.admin("GET", "/api/helpdesk/status", None).await.body["needsBootstrap"],
        true
    );
    let admin = f.bootstrap().await;
    assert_eq!(admin.user["role"], "administrator");
    let again = json!({ "name": "X", "email": "x@example.com", "password": PASSWORD });
    assert_eq!(
        f.admin("POST", "/api/helpdesk/bootstrap", Some(again)).await.status,
        409
    );
    let login = json!({ "email": "ADMIN@example.com", "password": PASSWORD });
    let reply = f.api("POST", "/auth/login", Some(login), &[]).await;
    assert!(
        reply
            .header("set-cookie")
            .unwrap_or_default()
            .contains("HttpOnly; SameSite=Strict"),
        "plain HTTP on the local network"
    );
    assert_eq!(f.login("admin@example.com", "senha-errada-000").await.err(), Some(401));
    assert_eq!(f.login("ninguem@example.com", PASSWORD).await.err(), Some(401));
    assert_eq!(
        f.admin("GET", "/api/helpdesk/status", None).await.body["needsBootstrap"],
        false
    );
}

#[tokio::test]
async fn api_rejects_missing_sessions_missing_csrf_and_foreign_origins() {
    let f = Fixture::new().await;
    let admin = f.bootstrap().await;
    assert_eq!(f.api("GET", "/conversations", None, &[]).await.status, 401);
    let no_csrf = f
        .api(
            "POST",
            "/teams",
            Some(json!({ "name": "Vendas" })),
            &[("cookie", &admin.cookie)],
        )
        .await;
    assert_eq!(no_csrf.status, 403);
    let foreign = f
        .api(
            "GET",
            "/auth/me",
            None,
            &[("cookie", &admin.cookie), ("origin", "https://evil.example")],
        )
        .await;
    assert_eq!(foreign.status, 403);
    let token = admin.post("/profile/access_token", json!({})).await.body["token"]
        .as_str()
        .unwrap_or_default()
        .to_string();
    let via_token = f.api("GET", "/auth/me", None, &[("api_access_token", &token)]).await;
    assert_eq!(via_token.body["user"]["email"], "admin@example.com");
    assert_eq!(
        f.api("GET", "/auth/me", None, &[("api_access_token", "wahd_x")])
            .await
            .status,
        401
    );
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

    f.incoming(
        &session.id,
        Incoming {
            id: "IN1",
            body: "Preciso de ajuda",
            name: "João",
            ..Default::default()
        },
    );
    f.incoming(
        &session.id,
        Incoming {
            id: "IN1",
            body: "Preciso de ajuda",
            ..Default::default()
        },
    );
    f.incoming(
        &session.id,
        Incoming {
            id: "IN2",
            body: "Alô?",
            ..Default::default()
        },
    );
    f.incoming(
        &session.id,
        Incoming {
            id: "G1",
            jid: "120363@g.us",
            body: "grupo",
            ..Default::default()
        },
    );

    let list = admin.get("/conversations").await.body;
    assert_eq!(list.as_array().map(Vec::len), Some(1));
    assert_eq!(list[0]["display_id"], 1);
    assert_eq!(list[0]["contact_name"], "João");
    assert_eq!(list[0]["contact_phone"], "+5511988887777");
    assert_eq!(list[0]["unread_count"], 2);
    let messages = admin.get("/conversations/1/messages").await.body;
    let summary: Vec<Value> = messages
        .as_array()
        .unwrap()
        .iter()
        .map(|m| json!([m["message_type"], m["content"], m["sender_name"]]))
        .collect();
    assert_eq!(
        summary,
        vec![
            json!(["incoming", "Preciso de ajuda", "João"]),
            json!(["incoming", "Alô?", "João"])
        ]
    );
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
    f.incoming(
        &a.id,
        Incoming {
            id: "A1",
            ..Default::default()
        },
    );
    f.incoming(
        &b.id,
        Incoming {
            id: "B1",
            jid: "5511900000000@s.whatsapp.net",
            ..Default::default()
        },
    );
    let mine = maria.get("/conversations").await.body;
    assert_eq!(mine.as_array().map(Vec::len), Some(1));
    assert_eq!(mine[0]["inbox_name"], "A");
    let other = admin.get("/conversations?q=900000").await.body[0]["display_id"]
        .as_i64()
        .unwrap();
    assert_eq!(maria.get(&format!("/conversations/{other}")).await.status, 404);
    let denied = maria
        .post(
            "/agents",
            json!({ "name": "x", "email": "x@x.com", "password": PASSWORD }),
        )
        .await;
    assert_eq!(denied.status, 403);
    assert_eq!(maria.get("/inboxes").await.body.as_array().map(Vec::len), Some(1));
}
