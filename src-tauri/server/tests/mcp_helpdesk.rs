//! Port of `tests/mcp-conversations-modern.test.mjs`: the helpdesk conversation tools served on the
//! modern MCP protocol, acting as the session inbox's bot over a real ingested conversation.
mod common;
mod mcp_support;

use common::Incoming;
use mcp_support::Mcp;
use serde_json::{json, Value};

fn text_json(reply: &common::http::Reply) -> Value {
    let text = reply.body["result"]["content"][0]["text"].as_str().unwrap_or_default();
    serde_json::from_str(text).unwrap_or(Value::Null)
}

#[tokio::test]
async fn helpdesk_conversation_tools_are_served_on_the_modern_protocol() {
    let m = Mcp::new().await;
    let tools = m.rpc("tools/list", json!({}), "writer", &[]).await.body["result"]["tools"].clone();
    let names: Vec<&str> = tools
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|t| t["name"].as_str())
        .collect();
    for name in [
        "list_conversations",
        "get_conversation",
        "reply_conversation",
        "set_conversation_status",
    ] {
        assert!(names.contains(&name), "{name}");
    }

    m.f.incoming(
        &m.session.id,
        Incoming {
            id: "IN1",
            body: "Preciso de ajuda",
            ..Default::default()
        },
    );
    let pending = json!({ "name": "set_conversation_status", "arguments": { "display_id": 1, "status": "pending" } });
    let changed = m.rpc("tools/call", pending, "writer", &[]).await;
    assert_eq!(changed.body["result"].get("isError"), None, "{}", changed.text);

    let list = json!({ "name": "list_conversations", "arguments": { "status": "pending" } });
    let listed = m.rpc("tools/call", list, "reader", &[]).await;
    let listed = text_json(&listed);
    assert_eq!(listed.as_array().map(Vec::len), Some(1), "{listed}");
    assert_eq!(
        (listed[0]["display_id"].clone(), listed[0]["status"].clone()),
        (json!(1), json!("pending"))
    );

    let call = json!({ "name": "reply_conversation", "arguments": { "display_id": 1, "content": "Olá!" } });
    let reply = m.rpc("tools/call", call, "writer", &[]).await;
    assert_eq!(reply.body["result"].get("isError"), None, "{}", reply.text);
    let message = text_json(&reply);
    assert_eq!(
        (message["content"].clone(), message["private"].clone()),
        (json!("Olá!"), json!(false))
    );
    let sent = m.f.wa.sent();
    assert_eq!(sent.len(), 1);
    assert_eq!(
        (sent[0].jid.as_str(), sent[0].text.as_str()),
        ("5511988887777@s.whatsapp.net", "Olá!")
    );

    let detail = json!({ "name": "get_conversation", "arguments": { "display_id": 1 } });
    let detail = text_json(&m.rpc("tools/call", detail, "reader", &[]).await);
    assert_eq!(detail["conversation"]["display_id"], 1);
    let contents: Vec<&Value> = detail["messages"]
        .as_array()
        .unwrap()
        .iter()
        .map(|m| &m["content"])
        .collect();
    assert!(contents.contains(&&json!("Olá!")), "{detail}");

    let denied = json!({ "name": "reply_conversation", "arguments": { "display_id": 1, "content": "x" } });
    let denied = m.rpc("tools/call", denied, "reader", &[]).await;
    assert_eq!(
        denied.body["result"]["isError"], true,
        "read-only credentials cannot reply"
    );
    assert_eq!(m.f.wa.sent().len(), 1);
}
