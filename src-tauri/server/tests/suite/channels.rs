//! The inbox's channel decides what reaches the contact: actions a channel does not have (reactions,
//! blocking, starting a conversation on GitHub) stay in the app and never go out through WhatsApp.
use crate::github_support;

use github_support::{connected, pr_opened};
use serde_json::json;

#[tokio::test]
async fn github_conversations_keep_whatsapp_actions_out() {
    let c = connected().await;
    assert_eq!(c.deliver("pull_request", "d1", &pr_opened(7), None).await, 202);
    let conversation = c.conversations().await.remove(0);
    let (display, contact) = (
        &conversation["display_id"],
        conversation["contact_id"].as_i64().unwrap(),
    );

    let messages = c.admin.get(&format!("/conversations/{display}/messages")).await.body;
    let first = messages[0]["id"].as_i64().unwrap();
    let reacted = c
        .admin
        .post(
            &format!("/conversations/{display}/messages/{first}/reactions"),
            json!({ "emoji": "👍" }),
        )
        .await;
    assert!(reacted.status < 300, "{:?}", reacted.body);
    let blocked = c
        .admin
        .patch(&format!("/contacts/{contact}"), json!({ "blocked": true }))
        .await;
    assert_eq!(blocked.body["blocked"], 1);
    assert!(c.f.wa.actions().is_empty(), "{:?}", c.f.wa.actions());

    let started = c
        .admin
        .post("/conversations", json!({ "contact_id": contact, "inbox_id": c.inbox }))
        .await;
    assert_eq!(started.status, 422, "{:?}", started.body);
}
