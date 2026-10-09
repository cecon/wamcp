//! Listener separation, hashed session-scoped MCP tokens, MCP isolation between sessions, send
//! permission and durable history (port of `tests/security.test.mjs`).
mod common;

use common::http::{request, send, Reply};
use common::{Fixture, ADMIN_TOKEN};
use serde_json::{json, Value};
use wamcp_server::adapters::inbound::mcp::catalog::tools;
use wamcp_server::adapters::outbound::sqlite::SqliteStore;
use wamcp_server::application::ports::{HistoryPage, MirrorRepo};
use wamcp_server::domain::model::{Session, WaMessage};

/// A stateless MCP client over the public router (2025-era JSON-RPC, like the SDK client).
struct Client<'a> {
    f: &'a Fixture,
    session: String,
    token: String,
}

impl Client<'_> {
    async fn rpc(&self, method: &str, params: Value) -> Reply {
        let body = json!({ "jsonrpc": "2.0", "id": 1, "method": method, "params": params });
        let auth = format!("Bearer {}", self.token);
        let headers = [
            ("authorization", auth.as_str()),
            ("accept", "application/json, text/event-stream"),
        ];
        self.f
            .public(request("POST", &format!("/mcp/{}", self.session), Some(body), &headers))
            .await
    }

    async fn connect<'a>(f: &'a Fixture, session: &Session, token: &str) -> Client<'a> {
        let client = Client {
            f,
            session: session.id.clone(),
            token: token.into(),
        };
        let info = json!({ "name": "security-test", "version": "1.0.0" });
        let init = json!({ "protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": info });
        let reply = client.rpc("initialize", init).await;
        assert_eq!(reply.status, 200, "{}", reply.text);
        client
    }

    /// Session (non-helpdesk) tool names, sorted; `Err(status)` when the request is refused.
    async fn list_tools(&self) -> Result<Vec<String>, u16> {
        let reply = self.rpc("tools/list", json!({})).await;
        if reply.status != 200 {
            return Err(reply.status);
        }
        let helpdesk: Vec<&str> = tools().iter().filter(|t| t.helpdesk).map(|t| t.name).collect();
        let listed = reply.body["result"]["tools"].as_array().cloned().unwrap_or_default();
        let mut names: Vec<String> = listed
            .iter()
            .filter_map(|t| t["name"].as_str().map(String::from))
            .collect();
        names.retain(|n| !helpdesk.contains(&n.as_str()));
        names.sort();
        Ok(names)
    }

    async fn call(&self, name: &str, arguments: Value) -> Value {
        let reply = self
            .rpc("tools/call", json!({ "name": name, "arguments": arguments }))
            .await;
        assert_eq!(reply.status, 200, "{}", reply.text);
        reply.body["result"].clone()
    }
}

fn wa_message(id: &str, body: &str, ts: i64) -> WaMessage {
    WaMessage {
        id: id.into(),
        jid: "5511999999999@s.whatsapp.net".into(),
        alt_jid: None,
        from_me: false,
        sender: "Contato".into(),
        push_name: None,
        body: body.into(),
        kind: "conversation".into(),
        ts,
    }
}

fn text_json(result: &Value) -> Value {
    serde_json::from_str(result["content"][0]["text"].as_str().unwrap_or_default()).unwrap_or(Value::Null)
}

#[tokio::test]
async fn public_listener_never_exposes_management_and_requires_authentication() {
    let f = Fixture::new().await;
    let s = f.session("Private");
    assert_eq!(f.public(request("GET", "/api/sessions", None, &[])).await.status, 404);
    assert_eq!(
        send(&f.app.admin_router(), request("GET", "/api/sessions", None, &[]))
            .await
            .status,
        401
    );
    assert_eq!(
        f.public(request("POST", &format!("/mcp/{}", s.id), None, &[]))
            .await
            .status,
        401
    );
    let auth = format!("Bearer {ADMIN_TOKEN}");
    let headers = [("authorization", auth.as_str()), ("origin", "https://evil.example")];
    assert_eq!(
        send(&f.app.admin_router(), request("GET", "/api/sessions", None, &headers))
            .await
            .status,
        403
    );
}

#[tokio::test]
async fn tokens_are_hashed_session_scoped_expiring_and_immediately_revocable() {
    let f = Fixture::new().await;
    let (a, b) = (f.session("A"), f.session("B"));
    let token = f.store.issue_token(&a.id, "Reader", "read", 90).unwrap();
    let listed = serde_json::to_value(f.store.tokens(&a.id).unwrap()).unwrap();
    assert!(listed[0].get("token").is_none(), "{listed}");
    let hash: String = f
        .store
        .with(|c| c.query_row("SELECT hash FROM tokens", [], |r| r.get(0)))
        .unwrap();
    assert_ne!(hash, token.token);
    assert!(f.store.authenticate(&b.id, &token.token).unwrap().is_none());
    let auth = format!("Bearer {}", token.token);
    let other = f
        .public(request(
            "POST",
            &format!("/mcp/{}", b.id),
            None,
            &[("authorization", &auth)],
        ))
        .await;
    assert_eq!(other.status, 401);
    f.store
        .with(|c| {
            c.execute(
                "UPDATE tokens SET expires=? WHERE id=?",
                ["2000-01-01T00:00:00.000Z", &token.id],
            )
        })
        .unwrap();
    assert!(f.store.authenticate(&a.id, &token.token).unwrap().is_none());
    let fresh = f.store.issue_token(&a.id, "New", "read", 90).unwrap();
    assert!(f.store.authenticate(&a.id, &fresh.token).unwrap().is_some());
    f.store.revoke(&a.id, &fresh.id).unwrap();
    assert!(f.store.authenticate(&a.id, &fresh.token).unwrap().is_none());
}

#[tokio::test]
async fn mcp_client_can_initialize_list_tools_and_only_read_its_own_session() {
    let f = Fixture::new().await;
    let (a, b) = (f.session("A"), f.session("B"));
    f.store
        .store_message(&a.id, &wa_message("a", "visible", 100), None)
        .unwrap();
    f.store
        .store_message(&b.id, &wa_message("b", "secret", 100), None)
        .unwrap();
    let token = f.store.issue_token(&a.id, "Reader", "read", 90).unwrap();
    let c = Client::connect(&f, &a, &token.token).await;
    let expected = [
        "get_media",
        "get_messages",
        "get_profile",
        "list_chats",
        "search_messages",
        "send_message",
        "session_status",
    ];
    assert_eq!(
        c.list_tools().await,
        Ok(expected.iter().map(|s| s.to_string()).collect())
    );
    let found = c.call("search_messages", json!({ "query": "visible" })).await;
    assert_eq!(text_json(&found)[0]["body"], "visible");
    let hidden = c.call("search_messages", json!({ "query": "secret" })).await;
    assert_eq!(text_json(&hidden), json!([]));
    let args = json!({ "jid": "5511999999999@s.whatsapp.net", "text": "no" });
    let denied = c.call("send_message", args).await;
    assert_eq!(denied["isError"], true);
    let challenge = denied["_meta"]["mcp/www_authenticate"][0].as_str().unwrap_or_default();
    assert!(challenge.contains("error=\"insufficient_scope\""), "{challenge}");
    assert!(
        challenge.contains("scope=\"whatsapp:read whatsapp:send\""),
        "{challenge}"
    );
    assert_eq!(f.wa.sent().len(), 0);
    f.store.revoke(&a.id, &token.id).unwrap();
    assert!(c.list_tools().await.is_err());
}

#[tokio::test]
async fn send_permission_exposes_sending_and_audit_and_rejects_invalid_recipients() {
    let f = Fixture::new().await;
    let s = f.session("Sender");
    let token = f.store.issue_token(&s.id, "Writer", "read_write", 90).unwrap();
    let c = Client::connect(&f, &s, &token.token).await;
    assert!(c.list_tools().await.unwrap().contains(&"send_message".to_string()));
    let invalid = c
        .call("send_message", json!({ "jid": "../../session", "text": "bad" }))
        .await;
    assert_eq!(invalid["isError"], true);
    assert_eq!(f.wa.sent().len(), 0);
    let args = json!({ "jid": "5511999999999@s.whatsapp.net", "text": "Authorized test" });
    let result = c.call("send_message", args).await;
    assert!(result.get("isError").is_none(), "{result}");
    assert_eq!(f.wa.sent().len(), 1);
    assert_eq!(f.store.audit_events(&s.id).unwrap()[0].action, "send_message");
}

#[test]
fn history_survives_restarts_and_duplicate_whatsapp_events_stay_idempotent() {
    let dir = tempfile::tempdir().expect("temp dir");
    let store = SqliteStore::open(dir.path()).expect("store");
    let s = store.create_session("Persistent").unwrap();
    let m = wa_message("message-1", "Saved", 10);
    store.store_message(&s.id, &m, None).unwrap();
    store.store_message(&s.id, &m, None).unwrap();
    drop(store);
    let store = SqliteStore::open(dir.path()).expect("reopen");
    assert_eq!(store.sessions().unwrap().len(), 1);
    let page = HistoryPage {
        before: None,
        before_id: None,
        limit: 100,
    };
    let messages = store.mirror_messages(&s.id, &m.jid, &page).unwrap();
    assert_eq!(messages.len(), 1);
    assert_eq!(messages[0].body, "Saved");
}
