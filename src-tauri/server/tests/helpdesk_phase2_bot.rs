//! Helpdesk phase 2: the MCP bot answers pending conversations and hands off to humans.
mod common;
mod helpdesk_support;

use axum::body::Body;
use axum::http::Request;
use common::http::{request, send};
use common::{Fixture, Incoming};
use helpdesk_support::{agent, items};
use serde_json::{json, Value};
use wamcp_server::application::ports::MirrorRepo;

/// A Streamable HTTP MCP client (2025 protocol) for one session token.
struct McpClient<'a> {
    f: &'a Fixture,
    session: String,
    token: String,
}

impl McpClient<'_> {
    async fn rpc(&self, method: &str, params: Value) -> Value {
        let body = json!({ "jsonrpc": "2.0", "id": 1, "method": method, "params": params });
        let auth = format!("Bearer {}", self.token);
        let headers = [
            ("authorization", auth.as_str()),
            ("accept", "application/json, text/event-stream"),
            ("mcp-protocol-version", "2025-06-18"),
        ];
        let req: Request<Body> = request("POST", &format!("/mcp/{}", self.session), Some(body), &headers);
        let reply = send(&self.f.app.public_router(), req).await;
        assert_eq!(reply.status, 200, "{method}: {}", reply.text);
        reply.body["result"].clone()
    }

    async fn call(&self, name: &str, args: Value) -> (Value, Option<Value>) {
        let result = self.rpc("tools/call", json!({ "name": name, "arguments": args })).await;
        let data = if result["isError"] == true {
            None
        } else {
            serde_json::from_str(result["content"][0]["text"].as_str().unwrap_or_default()).ok()
        };
        (result, data)
    }
}

async fn connect<'a>(f: &'a Fixture, session: &str, scope: &str) -> McpClient<'a> {
    let token = f.store.issue_token(session, "IA", scope, 90).expect("token").token;
    let client = McpClient {
        f,
        session: session.into(),
        token,
    };
    let init = json!({
        "protocolVersion": "2025-06-18",
        "capabilities": {},
        "clientInfo": { "name": "helpdesk-test", "version": "1.0.0" },
    });
    client.rpc("initialize", init).await;
    client
}

#[tokio::test]
async fn mcp_bot_answers_pending_conversations_and_hands_off_to_humans() {
    let f = Fixture::new().await;
    let s = f.session("Suporte");
    let admin = f.bootstrap().await;
    let inbox = admin.get("/inboxes").await.body[0]["id"].clone();
    admin
        .patch(&format!("/inboxes/{inbox}"), json!({ "agent_bot_enabled": true }))
        .await;
    let maria = agent(&f, &admin, "maria@example.com", json!([inbox])).await;
    maria.patch("/profile", json!({ "availability": "online" })).await;
    admin.post("/labels", json!({ "title": "triagem" })).await;
    f.incoming(
        &s.id,
        Incoming {
            id: "IN1",
            body: "Quero saber meu pedido",
            ..Default::default()
        },
    );
    assert_eq!(admin.get("/conversations/1").await.body["status"], "pending");
    assert_eq!(
        admin.get("/conversations/1").await.body["assignee_id"],
        Value::Null,
        "bots work before humans"
    );

    let bot = connect(&f, &s.id, "read_write").await;
    let (_, pending) = bot.call("list_conversations", json!({ "status": "pending" })).await;
    let pending = pending.expect("pending");
    let ids: Vec<&Value> = items(&pending).iter().map(|c| &c["display_id"]).collect();
    assert_eq!(ids, vec![&json!(1)]);
    let (_, detail) = bot.call("get_conversation", json!({ "display_id": 1 })).await;
    assert_eq!(
        detail.expect("detail")["messages"][0]["content"],
        "Quero saber meu pedido"
    );
    let (_, reply) = bot
        .call(
            "reply_conversation",
            json!({ "display_id": 1, "content": "Vou verificar." }),
        )
        .await;
    assert_eq!(reply.expect("reply")["sender_name"], "Assistente IA");
    assert_eq!(
        f.wa.sent().last().map(|m| m.text.clone()).as_deref(),
        Some("Vou verificar.")
    );
    bot.call(
        "set_conversation_labels",
        json!({ "display_id": 1, "labels": ["triagem"] }),
    )
    .await;
    let (_, handoff) = bot
        .call("set_conversation_status", json!({ "display_id": 1, "status": "open" }))
        .await;
    assert_eq!(
        handoff.expect("handoff")["assignee_id"].as_i64(),
        Some(maria.id()),
        "handoff triggers auto-assignment"
    );
    let handed = f
        .events
        .lock()
        .iter()
        .any(|e| e.event == "conversation.bot_handoff" && e.performer.is("agent_bot"));
    assert!(handed);

    let reader = connect(&f, &s.id, "read").await;
    let (denied, _) = reader
        .call("reply_conversation", json!({ "display_id": 1, "content": "x" }))
        .await;
    assert_eq!(denied["isError"], true);
    assert_eq!(f.wa.sent().len(), 1);
}
