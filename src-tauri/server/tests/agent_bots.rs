//! Agent bots: inbox events delivered to the bot URL, replies and handoffs with the bot token.
mod common;

use common::http::Reply;
use common::{Fixture, Incoming};
use serde_json::{json, Value};

async fn as_bot(f: &Fixture, token: &str, method: &str, path: &str, body: Value) -> Reply {
    f.api(method, path, Some(body), &[("api_access_token", token)]).await
}

fn bot_events(f: &Fixture) -> Vec<String> {
    f.sender
        .posts
        .lock()
        .iter()
        .filter(|(url, _, _)| url == "https://bot.example.com/hook")
        .map(|(_, body, _)| body["event"].as_str().unwrap_or_default().to_string())
        .collect()
}

#[tokio::test]
async fn bots_receive_inbox_events_and_answer_with_their_token() {
    let f = Fixture::new().await;
    let session = f.session("Suporte");
    let other = f.session("Vendas");
    let admin = f.bootstrap().await;
    let maria = f.agent(&admin, "maria@example.com", "agent", true).await;
    let webhooks = f.app.state.support().webhooks.clone();
    let bot =
        json!({ "name": "Triagem", "description": "Robô de triagem", "outgoing_url": "https://bot.example.com/hook" });
    assert_eq!(maria.post("/agent_bots", bot.clone()).await.status, 403);
    assert_eq!(
        admin
            .post("/agent_bots", json!({ "name": "x", "outgoing_url": "ftp://x" }))
            .await
            .status,
        400
    );
    assert_eq!(
        admin
            .post("/agent_bots", json!({ "outgoing_url": "https://x.dev" }))
            .await
            .status,
        400
    );
    let created = admin.post("/agent_bots", bot).await.body;
    let token = created["access_token"].as_str().unwrap().to_string();
    let bot_id = created["agent_bot"]["id"].as_i64().unwrap();
    assert!(
        admin.get("/webhooks").await.body.as_array().unwrap().is_empty(),
        "bot endpoints are not webhooks"
    );
    let inboxes = admin.get("/inboxes").await.body;
    let (support, sales) = (inboxes[0]["id"].as_i64().unwrap(), inboxes[1]["id"].as_i64().unwrap());
    let connected = admin
        .post(
            &format!("/inboxes/{support}/agent_bot"),
            json!({ "agent_bot_id": bot_id }),
        )
        .await;
    assert_eq!(connected.body["agent_bot_id"], bot_id);
    assert_eq!(
        admin
            .post(&format!("/inboxes/{support}/agent_bot"), json!({ "agent_bot_id": 999 }))
            .await
            .status,
        404
    );
    assert_eq!(admin.get("/agent_bots").await.body[0]["inbox_ids"], json!([support]));

    f.incoming(&session.id, Incoming::default());
    let elsewhere = Incoming {
        id: "IN2",
        jid: "5511900000002@s.whatsapp.net",
        ..Default::default()
    };
    f.incoming(&other.id, elsewhere);
    assert_eq!(
        admin.get("/conversations/1").await.body["status"],
        "pending",
        "bots take new conversations first"
    );
    webhooks.deliver_due().await.unwrap();
    let events = bot_events(&f);
    assert!(events.contains(&"conversation_created".to_string()) && events.contains(&"message_created".to_string()));
    let bodies: Vec<Value> = f.sender.posts.lock().iter().map(|(_, b, _)| b.clone()).collect();
    assert!(
        bodies.iter().all(|b| b["data"]["inbox_id"].as_i64() != Some(sales)),
        "only its inboxes"
    );

    let reply = as_bot(
        &f,
        &token,
        "POST",
        "/conversations/1/messages",
        json!({ "content": "Olá! Sou o robô." }),
    )
    .await;
    assert_eq!(
        (reply.status, reply.body["sender_type"].as_str()),
        (201, Some("agent_bot"))
    );
    assert_eq!(f.wa.sent().last().unwrap().text, "Olá! Sou o robô.");
    let handoff = as_bot(
        &f,
        &token,
        "POST",
        "/conversations/1/toggle_status",
        json!({ "status": "open" }),
    )
    .await;
    assert_eq!(handoff.body["status"], "open");
    let foreign = as_bot(
        &f,
        &token,
        "POST",
        "/conversations/2/messages",
        json!({ "content": "x" }),
    )
    .await;
    assert_eq!(foreign.status, 403);
    assert_eq!(
        f.api("GET", "/conversations", None, &[("api_access_token", &token)])
            .await
            .status,
        401
    );

    let reset = admin
        .post(&format!("/agent_bots/{bot_id}/reset_access_token"), json!({}))
        .await
        .body;
    let stale = as_bot(
        &f,
        &token,
        "POST",
        "/conversations/1/messages",
        json!({ "content": "x" }),
    )
    .await;
    assert_eq!(stale.status, 401);
    let fresh = reset["access_token"].as_str().unwrap();
    assert_eq!(
        as_bot(
            &f,
            fresh,
            "POST",
            "/conversations/1/messages",
            json!({ "content": "ok" })
        )
        .await
        .status,
        201
    );
    let deliveries = admin.get(&format!("/agent_bots/{bot_id}/deliveries")).await.body;
    assert!(!deliveries.as_array().unwrap().is_empty());
    let renamed = admin
        .patch(
            &format!("/agent_bots/{bot_id}"),
            json!({ "name": "Triagem 2", "outgoing_url": "https://bot.example.com/v2" }),
        )
        .await
        .body;
    assert_eq!(
        (renamed["name"].as_str(), renamed["outgoing_url"].as_str()),
        (Some("Triagem 2"), Some("https://bot.example.com/v2"))
    );
    assert_eq!(
        admin
            .patch(&format!("/agent_bots/{bot_id}"), json!({ "outgoing_url": "nada" }))
            .await
            .status,
        400
    );

    admin
        .post(
            &format!("/inboxes/{support}/agent_bot"),
            json!({ "agent_bot_id": null }),
        )
        .await;
    let third = Incoming {
        id: "IN3",
        jid: "5511900000003@s.whatsapp.net",
        ..Default::default()
    };
    f.incoming(&session.id, third);
    assert_eq!(admin.get("/conversations/3").await.body["status"], "open");
    assert_eq!(admin.del(&format!("/agent_bots/{bot_id}"), None).await.status, 200);
    assert_eq!(admin.del(&format!("/agent_bots/{bot_id}"), None).await.status, 404);
    assert_eq!(
        as_bot(
            &f,
            fresh,
            "POST",
            "/conversations/1/messages",
            json!({ "content": "x" })
        )
        .await
        .status,
        401
    );
}
