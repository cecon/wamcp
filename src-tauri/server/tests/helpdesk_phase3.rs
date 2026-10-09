//! Helpdesk phase 3: webhooks and automation rules.
mod common;

use common::{Agent, Fixture, Incoming, PASSWORD};
use serde_json::{json, Value};
use wamcp_server::application::ports::SendFailure;
use wamcp_server::domain::model::Session;

async fn setup() -> (Fixture, Session, Agent) {
    let f = Fixture::new().await;
    let session = f.session("Suporte");
    let admin = f.bootstrap().await;
    (f, session, admin)
}

fn items(value: &Value) -> &Vec<Value> {
    value.as_array().expect("array")
}

fn sent_texts(f: &Fixture) -> Vec<String> {
    f.wa.sent().into_iter().map(|m| m.text).collect()
}

#[tokio::test]
async fn webhooks_queue_signed_deliveries_filter_by_inbox_and_retry_with_backoff() {
    let (f, session, admin) = setup().await;
    let maria = json!({ "name": "Maria", "email": "maria@example.com", "password": PASSWORD, "inbox_ids": [] });
    admin.post("/agents", maria).await;
    let maria = f.login("maria@example.com", PASSWORD).await.expect("maria login");
    assert_eq!(maria.get("/webhooks").await.status, 403);
    let ftp = admin
        .post(
            "/webhooks",
            json!({ "url": "ftp://x", "subscriptions": ["message_created"] }),
        )
        .await;
    assert_eq!(ftp.status, 400);
    let subscriptions = json!(["message_created", "conversation_created"]);
    let hook = admin
        .post(
            "/webhooks",
            json!({ "url": "https://crm.example/hook", "subscriptions": subscriptions }),
        )
        .await;
    let hook = hook.body;
    assert_eq!(hook["secret"], "test-secret");
    let mut missing_inbox =
        json!({ "url": "https://other.example/hook", "subscriptions": ["message_created"], "inbox_id": 999 });
    assert_eq!(admin.post("/webhooks", missing_inbox.clone()).await.status, 422);
    let session_b = f.session("Vendas");
    let inboxes = admin.get("/inboxes").await.body;
    let inbox_b = items(&inboxes)
        .iter()
        .find(|i| i["session_id"] == session_b.id.as_str())
        .expect("inbox B");
    missing_inbox["inbox_id"] = inbox_b["id"].clone();
    assert_eq!(admin.post("/webhooks", missing_inbox).await.status, 201);

    let webhooks = &f.app.state.support().webhooks;
    f.incoming(
        &session.id,
        Incoming {
            id: "IN1",
            body: "Olá",
            ..Default::default()
        },
    );
    webhooks.deliver_due().await.expect("deliver");
    {
        let posts = f.sender.posts.lock();
        let summary: Vec<(String, Value)> = posts
            .iter()
            .map(|(url, body, _)| (url.clone(), body["event"].clone()))
            .collect();
        assert_eq!(
            summary,
            vec![
                ("https://crm.example/hook".to_string(), json!("conversation_created")),
                ("https://crm.example/hook".to_string(), json!("message_created")),
            ]
        );
        assert_eq!(posts[1].1["data"]["content"], "Olá");
        assert_eq!(posts[1].2, "test-secret");
    }

    *f.sender.status.lock() = Some(Ok(503));
    f.incoming(
        &session.id,
        Incoming {
            id: "IN2",
            body: "Alô",
            ..Default::default()
        },
    );
    webhooks.deliver_due().await.expect("deliver");
    let deliveries_path = format!("/webhooks/{}/deliveries", hook["id"]);
    let deliveries = admin.get(&deliveries_path).await.body;
    let first = json!([
        deliveries[0]["status"],
        deliveries[0]["attempts"],
        deliveries[0]["last_error"]
    ]);
    assert_eq!(first, json!(["pending", 1, "HTTP 503"]));
    webhooks.deliver_due().await.expect("deliver");
    assert_eq!(
        admin.get(&deliveries_path).await.body[0]["attempts"],
        1,
        "waits for the backoff"
    );
    *f.sender.status.lock() = Some(Err(SendFailure::Connection));
    for delay in [30, 120, 600, 3600] {
        f.tick(delay);
        webhooks.deliver_due().await.expect("deliver");
    }
    let deliveries = admin.get(&deliveries_path).await.body;
    let last = json!([
        deliveries[0]["status"],
        deliveries[0]["attempts"],
        deliveries[0]["last_error"]
    ]);
    assert_eq!(last, json!(["failed", 5, "Falha de conexão"]));

    let hook_path = format!("/webhooks/{}", hook["id"]);
    assert_eq!(
        admin.patch(&hook_path, json!({ "active": false })).await.body["active"],
        0
    );
    assert_eq!(admin.patch(&hook_path, json!({ "url": "bad" })).await.status, 400);
    assert_eq!(admin.del(&hook_path, None).await.status, 200);
    assert_eq!(admin.get(&deliveries_path).await.status, 404);
}

#[tokio::test]
async fn automation_rules_run_actions_once_without_retriggering_themselves() {
    let (f, session, admin) = setup().await;
    admin.post("/labels", json!({ "title": "financeiro" })).await;
    let team = admin.post("/teams", json!({ "name": "Cobrança" })).await.body;
    let invalid = admin
        .post(
            "/automation_rules",
            json!({
                "name": "x",
                "event_name": "message_created",
                "conditions": [],
                "actions": [{ "action_name": "add_label" }],
            }),
        )
        .await;
    assert_eq!(invalid.status, 400);
    let rule = admin
        .post(
            "/automation_rules",
            json!({
                "name": "Boletos",
                "event_name": "message_created",
                "conditions": [
                    { "attribute_key": "message_type", "filter_operator": "equal_to", "values": ["incoming"] },
                    { "attribute_key": "content", "filter_operator": "contains", "values": ["boleto"] },
                ],
                "actions": [
                    { "action_name": "add_label", "action_params": ["financeiro"] },
                    { "action_name": "assign_team", "action_params": [team["id"]] },
                    { "action_name": "set_priority", "action_params": ["high"] },
                    { "action_name": "send_message", "action_params": ["Já encaminhei para o financeiro."] },
                    { "action_name": "add_private_note", "action_params": ["Cliente pediu boleto (automação)"] },
                    { "action_name": "assign_agent", "action_params": [999] },
                ],
            }),
        )
        .await;
    assert_eq!(rule.status, 201);
    f.incoming(
        &session.id,
        Incoming {
            id: "IN1",
            body: "Preciso do BOLETO de outubro",
            ..Default::default()
        },
    );
    f.settle().await;
    let conversation = admin.get("/conversations/1").await.body;
    let summary = json!([
        conversation["labels"],
        conversation["team_name"],
        conversation["priority"]
    ]);
    assert_eq!(summary, json!([["financeiro"], "Cobrança", "high"]));
    assert_eq!(
        sent_texts(&f),
        vec!["Já encaminhei para o financeiro."],
        "sent once, no loop"
    );
    let messages = admin.get("/conversations/1/messages").await.body;
    let messages = items(&messages);
    let automated = messages
        .iter()
        .find(|m| m["content"] == "Já encaminhei para o financeiro.")
        .expect("automated");
    assert_eq!(automated["content_attributes"]["automated"], "Automação “Boletos”");
    let note = |m: &Value| m["private"] == true && m["content"].as_str().unwrap_or_default().contains("automação");
    assert!(messages.iter().any(note));
    let activity = |m: &Value| {
        m["message_type"] == "activity"
            && m["content"]
                .as_str()
                .unwrap_or_default()
                .starts_with("Automação “Boletos” adicionou")
    };
    assert!(messages.iter().any(activity));

    let rule_path = format!("/automation_rules/{}", rule.body["id"]);
    admin.patch(&rule_path, json!({ "active": false })).await;
    f.incoming(
        &session.id,
        Incoming {
            id: "IN2",
            jid: "5511900000000@s.whatsapp.net",
            body: "boleto",
            ..Default::default()
        },
    );
    f.settle().await;
    assert_eq!(f.wa.sent().len(), 1);
    assert_eq!(admin.get("/automation_rules").await.body[0]["active"], 0);
    assert_eq!(
        admin.patch(&rule_path, json!({ "event_name": "nope" })).await.status,
        400
    );
    assert_eq!(admin.del(&rule_path, None).await.status, 200);
    assert_eq!(admin.del(&rule_path, None).await.status, 404);
}

#[tokio::test]
async fn rules_on_resolution_and_reopening_can_resolve_or_reopen_conversations() {
    let (f, session, admin) = setup().await;
    let reopen = json!({
        "name": "Reabrir VIP",
        "event_name": "conversation_resolved",
        "conditions": [{ "attribute_key": "contact_name", "filter_operator": "equal_to", "values": ["vip"] }],
        "actions": [{ "action_name": "open_conversation" }],
    });
    admin.post("/automation_rules", reopen).await;
    let spam = json!({
        "name": "Fechar spam",
        "event_name": "conversation_created",
        "conditions": [{ "attribute_key": "contact_name", "filter_operator": "contains", "values": ["spam"] }],
        "actions": [{ "action_name": "resolve_conversation" }],
    });
    admin.post("/automation_rules", spam).await;
    f.incoming(
        &session.id,
        Incoming {
            id: "IN1",
            name: "VIP",
            ..Default::default()
        },
    );
    f.incoming(
        &session.id,
        Incoming {
            id: "IN2",
            jid: "5511900000000@s.whatsapp.net",
            name: "Spammer",
            ..Default::default()
        },
    );
    f.settle().await;
    admin
        .post("/conversations/1/toggle_status", json!({ "status": "resolved" }))
        .await;
    f.settle().await;
    assert_eq!(admin.get("/conversations/1").await.body["status"], "open");
    assert_eq!(admin.get("/conversations/2").await.body["status"], "resolved");
}
