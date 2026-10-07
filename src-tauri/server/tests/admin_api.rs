//! Desktop admin API on the local listener: sessions, connection control, history, MCP tokens,
//! audit and unknown-session 404s (the admin token / origin guard lives in `admin_api_guard.rs`).
mod common;

use common::http::{request, send, Reply};
use common::{Fixture, ORIGIN};
use serde_json::{json, Value};
use wamcp_server::application::ports::MirrorRepo;
use wamcp_server::domain::model::{ChatUpdate, WaMessage};

const JID: &str = "5511999999999@s.whatsapp.net";

fn wa(id: &str, jid: &str, body: &str, ts: i64) -> WaMessage {
    WaMessage {
        id: id.into(),
        jid: jid.into(),
        alt_jid: None,
        from_me: false,
        sender: "Cliente".into(),
        push_name: None,
        body: body.into(),
        kind: "conversation".into(),
        ts,
    }
}

async fn mcp_tool(f: &Fixture, session_id: &str, token: &str, name: &str) -> Reply {
    let params = json!({ "name": name, "arguments": {} });
    let body = json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": params });
    let auth = format!("Bearer {token}");
    let path = format!("/mcp/{session_id}");
    send(
        &f.app.public_router(),
        request("POST", &path, Some(body), &[("authorization", &auth)]),
    )
    .await
}

#[tokio::test]
async fn status_and_sessions_are_listed_and_created() {
    let f = Fixture::new().await;
    let status = f.admin("GET", "/api/status", None).await;
    assert_eq!(
        status.body,
        json!({ "publicUrl": ORIGIN, "service": "ready", "sessions": 0 })
    );
    let created = f
        .admin("POST", "/api/sessions", Some(json!({ "name": "  Loja  " })))
        .await;
    assert_eq!(created.status, 201, "{}", created.text);
    assert_eq!(created.body["name"], "Loja");
    assert_eq!(created.body["status"], "disconnected");
    let id = created.body["id"].as_str().expect("id").to_string();
    for bad in [
        json!({ "name": "   " }),
        json!({ "name": "x".repeat(81) }),
        json!({}),
        json!({ "name": 5 }),
    ] {
        assert_eq!(
            f.admin("POST", "/api/sessions", Some(bad.clone())).await.status,
            400,
            "{bad}"
        );
    }
    f.store
        .store_message(&id, &wa("M1", JID, "oi", 10), None)
        .expect("message");
    let sessions = f.admin("GET", "/api/sessions", None).await.body;
    assert_eq!(sessions.as_array().map(Vec::len), Some(1));
    assert_eq!(sessions[0]["id"], id.as_str());
    assert_eq!(sessions[0]["message_count"], 1);
    assert_eq!(f.admin("GET", "/api/status", None).await.body["sessions"], 1);
}

#[tokio::test]
async fn session_detail_carries_connection_state_and_mcp_url() {
    let f = Fixture::new().await;
    let session = f.session("Loja");
    let detail = f.admin("GET", &format!("/api/sessions/{}", session.id), None).await;
    assert_eq!(detail.status, 200);
    assert_eq!(detail.body["id"], session.id.as_str());
    assert_eq!(detail.body["name"], "Loja");
    assert_eq!(detail.body["mcpUrl"], format!("{ORIGIN}/mcp/{}", session.id));
    assert!(
        detail.body.get("qr").is_some() && detail.body.get("error").is_some(),
        "{}",
        detail.body
    );
}

#[tokio::test]
async fn connect_disconnect_and_logout_drive_the_whatsapp_port() {
    let f = Fixture::new().await;
    let session = f.session("Loja");
    let path = |action: &str| format!("/api/sessions/{}/{action}", session.id);
    assert_eq!(
        f.admin("POST", &path("connect"), None).await.body,
        json!({ "ok": true })
    );
    assert!(f.wa.connected.lock().contains(&session.id));
    assert_eq!(
        f.admin("POST", &path("disconnect"), None).await.body,
        json!({ "ok": true })
    );
    assert!(!f.wa.connected.lock().contains(&session.id));
    f.admin("POST", &path("connect"), None).await;
    assert_eq!(f.admin("POST", &path("logout"), None).await.body, json!({ "ok": true }));
    assert!(!f.wa.connected.lock().contains(&session.id));
}

#[tokio::test]
async fn unknown_sessions_answer_404_on_every_session_route() {
    let f = Fixture::new().await;
    let routes = [
        ("GET", "/api/sessions/nope"),
        ("POST", "/api/sessions/nope/connect"),
        ("POST", "/api/sessions/nope/disconnect"),
        ("POST", "/api/sessions/nope/logout"),
        ("GET", "/api/sessions/nope/chats"),
        ("GET", "/api/sessions/nope/messages?jid=5511999999999@s.whatsapp.net"),
        ("GET", "/api/sessions/nope/search?q=oi"),
        ("GET", "/api/sessions/nope/tokens"),
        ("DELETE", "/api/sessions/nope/tokens/abc"),
        ("GET", "/api/sessions/nope/audit"),
    ];
    for (method, path) in routes {
        let reply = f.admin(method, path, None).await;
        assert_eq!(reply.status, 404, "{method} {path}");
        assert_eq!(
            reply.body,
            json!({ "error": "Sessão não encontrada" }),
            "{method} {path}"
        );
    }
    let issue = f
        .admin(
            "POST",
            "/api/sessions/nope/tokens",
            Some(json!({ "name": "x", "scope": "read" })),
        )
        .await;
    assert_eq!(issue.status, 404);
}

#[tokio::test]
async fn chats_and_search_read_the_mirror() {
    let f = Fixture::new().await;
    let session = f.session("Loja");
    let other = "5522988887777@s.whatsapp.net";
    f.store
        .store_message(&session.id, &wa("A1", JID, "pedido 123", 10), None)
        .expect("a1");
    f.store
        .store_message(&session.id, &wa("A2", JID, "obrigado", 20), None)
        .expect("a2");
    f.store
        .store_message(&session.id, &wa("B1", other, "outro pedido", 30), None)
        .expect("b1");
    let named = ChatUpdate {
        jid: JID.into(),
        name: Some("Maria".into()),
        updated: 0,
    };
    f.store.upsert_chat(&session.id, &named).expect("chat");
    let chats = f
        .admin("GET", &format!("/api/sessions/{}/chats", session.id), None)
        .await
        .body;
    let order: Vec<Value> = chats
        .as_array()
        .expect("chats")
        .iter()
        .map(|c| json!([c["jid"], c["preview"]]))
        .collect();
    assert_eq!(order, vec![json!([other, "outro pedido"]), json!([JID, "obrigado"])]);
    let named = f
        .admin("GET", &format!("/api/sessions/{}/chats?q=Mar", session.id), None)
        .await
        .body;
    assert_eq!(named.as_array().map(Vec::len), Some(1));
    assert_eq!(named[0]["name"], "Maria");

    let found = f
        .admin("GET", &format!("/api/sessions/{}/search?q=pedido", session.id), None)
        .await
        .body;
    let ids: Vec<&str> = found
        .as_array()
        .expect("found")
        .iter()
        .filter_map(|m| m["id"].as_str())
        .collect();
    assert_eq!(ids, vec!["B1", "A1"]);
    assert_eq!(
        f.admin("GET", &format!("/api/sessions/{}/search", session.id), None)
            .await
            .status,
        400
    );
    let long = format!("/api/sessions/{}/search?q={}", session.id, "x".repeat(201));
    assert_eq!(f.admin("GET", &long, None).await.status, 400);
}

#[tokio::test]
async fn tokens_are_issued_listed_revoked_and_audited() {
    let f = Fixture::new().await;
    let session = f.session("Loja");
    let tokens = format!("/api/sessions/{}/tokens", session.id);
    let issued = f
        .admin("POST", &tokens, Some(json!({ "name": " Claude ", "scope": "read" })))
        .await;
    assert_eq!(issued.status, 201, "{}", issued.text);
    assert_eq!(
        (issued.body["name"].clone(), issued.body["scope"].clone()),
        (json!("Claude"), json!("read"))
    );
    let secret = issued.body["token"].as_str().expect("token").to_string();
    assert!(secret.starts_with("wamcp_"));
    let token_id = issued.body["id"].as_str().expect("id").to_string();
    let invalid = [
        json!({ "name": "x", "scope": "admin" }),
        json!({ "name": "", "scope": "read" }),
        json!({ "name": "x", "scope": "read", "days": 0 }),
        json!({ "name": "x", "scope": "read", "days": 366 }),
    ];
    for body in invalid {
        assert_eq!(f.admin("POST", &tokens, Some(body.clone())).await.status, 400, "{body}");
    }
    let writer = f
        .admin(
            "POST",
            &tokens,
            Some(json!({ "name": "w", "scope": "read_write", "days": 365 })),
        )
        .await;
    assert_eq!(writer.status, 201);

    let listed = f.admin("GET", &tokens, None).await;
    assert_eq!(listed.body.as_array().map(Vec::len), Some(2));
    assert!(
        !listed.text.contains(&secret) && !listed.text.contains("hash"),
        "{}",
        listed.text
    );

    assert_eq!(mcp_tool(&f, &session.id, &secret, "get_profile").await.status, 200);
    let audit = f
        .admin("GET", &format!("/api/sessions/{}/audit", session.id), None)
        .await
        .body;
    assert_eq!(audit[0]["action"], "get_profile");
    assert_eq!(audit[0]["token_id"], token_id.as_str());

    let revoked = f.admin("DELETE", &format!("{tokens}/{token_id}"), None).await;
    assert_eq!(revoked.body, json!({ "ok": true }));
    let remaining = f.admin("GET", &tokens, None).await.body;
    assert_eq!(remaining.as_array().map(Vec::len), Some(1));
    assert_eq!(remaining[0]["scope"], "read_write");
    assert_eq!(mcp_tool(&f, &session.id, &secret, "get_profile").await.status, 401);
    assert!(f.store.authenticate(&session.id, &secret).expect("auth").is_none());
}
