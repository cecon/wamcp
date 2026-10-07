//! SLA policies: applying them, deadlines, hit/missed settlement, alerts and metrics.
mod common;

use common::{Fixture, Incoming};
use serde_json::{json, Value};

fn kinds(list: &Value) -> Vec<String> {
    list["items"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|n| n["notification_type"].as_str().map(String::from))
        .collect()
}

#[tokio::test]
async fn slas_are_applied_settled_and_measured() {
    let f = Fixture::new().await;
    let session = f.session("Suporte");
    let admin = f.bootstrap().await;
    let maria = f.agent(&admin, "maria@example.com", "agent", true).await;
    let helpdesk = f.app.state.support().helpdesk.clone();
    let gold = json!({ "name": "Ouro", "first_response_time_threshold": 300, "resolution_time_threshold": 3600 });
    assert_eq!(maria.post("/sla_policies", gold.clone()).await.status, 403);
    let gold = admin.post("/sla_policies", gold).await.body;
    for bad in [
        json!({ "name": "Vazio" }),
        json!({ "name": "Rápido", "first_response_time_threshold": 30 }),
        json!({ "first_response_time_threshold": 300 }),
    ] {
        assert_eq!(admin.post("/sla_policies", bad.clone()).await.status, 400, "{bad}");
    }
    assert_eq!(maria.get("/sla_policies").await.body.as_array().unwrap().len(), 1);

    f.incoming(&session.id, Incoming::default());
    admin
        .post("/conversations/1/assignments", json!({ "assignee_id": maria.id() }))
        .await;
    assert_eq!(maria.get("/conversations/1/sla").await.body, Value::Null);
    let applied = maria
        .post("/conversations/1/sla", json!({ "sla_policy_id": gold["id"] }))
        .await
        .body;
    assert_eq!(applied["state"]["status"], "active");
    assert_eq!(applied["state"]["first_response_due_at"], f.now() + 300);
    assert_eq!(
        maria
            .post("/conversations/1/sla", json!({ "sla_policy_id": 999 }))
            .await
            .status,
        404
    );
    f.tick(200);
    maria
        .post("/conversations/1/messages", json!({ "content": "Olá!" }))
        .await;
    let replied = maria.get("/conversations/1/sla").await.body;
    assert!(
        replied["state"]["first_response_due_at"].is_null(),
        "first response met"
    );
    f.tick(4000);
    assert_eq!(helpdesk.check_slas().unwrap(), 1);
    let missed = maria.get("/conversations/1/sla").await.body;
    assert_eq!(
        (missed["applied"]["status"].as_str(), missed["state"]["missed"].clone()),
        (Some("missed"), json!(["resolution"]))
    );
    assert!(kinds(&maria.get("/notifications").await.body).contains(&"sla_missed".to_string()));
    assert!(f.event_names().contains(&"sla.missed".to_string()));

    let other = Incoming {
        id: "IN2",
        jid: "5511900000002@s.whatsapp.net",
        ..Default::default()
    };
    f.incoming(&session.id, other);
    let action = json!([{ "action_name": "add_sla", "action_params": [gold["id"]] }]);
    let macro_id = admin
        .post("/macros", json!({ "name": "SLA ouro", "actions": action }))
        .await
        .body["id"]
        .clone();
    admin
        .post(
            &format!("/macros/{macro_id}/execute"),
            json!({ "conversation_ids": [2] }),
        )
        .await;
    admin
        .post("/conversations/2/messages", json!({ "content": "Resolvido" }))
        .await;
    admin
        .post("/conversations/2/toggle_status", json!({ "status": "resolved" }))
        .await;
    assert_eq!(helpdesk.check_slas().unwrap(), 1);
    assert_eq!(admin.get("/conversations/2/sla").await.body["applied"]["status"], "hit");
    assert_eq!(helpdesk.check_slas().unwrap(), 0);
    let metrics = admin.get("/applied_slas/metrics").await.body;
    assert_eq!(
        json!([metrics["total"], metrics["hit"], metrics["missed"], metrics["hit_rate"]]),
        json!([2, 1, 1, 50.0])
    );
    assert_eq!(maria.get("/applied_slas/metrics").await.status, 403);

    let path = format!("/sla_policies/{}", gold["id"]);
    let silver = json!({ "name": "Prata", "next_response_time_threshold": 600 });
    let updated = admin.put(&path, silver).await.body;
    assert_eq!(
        (
            updated["name"].as_str(),
            updated["first_response_time_threshold"].clone()
        ),
        (Some("Prata"), Value::Null)
    );
    assert_eq!(
        admin
            .put(
                "/sla_policies/999",
                json!({ "name": "x", "resolution_time_threshold": 600 })
            )
            .await
            .status,
        404
    );
    assert_eq!(admin.del(&path, None).await.status, 200);
    assert_eq!(
        maria.get("/conversations/1/sla").await.body,
        Value::Null,
        "deleting the policy removes it"
    );
}

#[test]
fn next_response_counts_while_the_contact_waits() {
    use wamcp_server::domain::model::{Conversation, SlaPolicy};
    use wamcp_server::domain::sla::evaluate;
    let policy: SlaPolicy = serde_json::from_value(json!({ "id": 1, "name": "x", "description": null,
        "first_response_time_threshold": null, "next_response_time_threshold": 600,
        "resolution_time_threshold": null, "created": "" }))
    .unwrap();
    let conversation: Conversation = serde_json::from_value(json!({
        "id": 1, "account_id": 1, "display_id": 1, "inbox_id": 1, "contact_id": 1, "contact_inbox_id": 1,
        "status": "open", "priority": null, "assignee_id": null, "team_id": null, "snoozed_until": null,
        "waiting_since": 1000, "first_reply_at": 500, "agent_last_seen_at": null, "last_activity_at": 1000,
        "custom_attributes": {}, "created": "", "csat_requested_at": null, "contact_name": null, "contact_phone": null,
        "contact_jid": "x", "inbox_name": "x", "agent_bot_enabled": 0, "assignee_name": null, "team_name": null,
        "labels": [], "last_message": null, "unread_count": 0
    }))
    .unwrap();
    let waiting = evaluate(&policy, 100, &conversation, None, 1500);
    assert_eq!((waiting.status, waiting.next_response_due_at), ("active", Some(1600)));
    let late = evaluate(&policy, 100, &conversation, None, 1700);
    assert_eq!((late.status, late.missed.clone()), ("missed", vec!["next_response"]));
    let done = evaluate(&policy, 100, &conversation, Some(1100), 1700);
    assert_eq!(
        done.status, "missed",
        "a pending wait at resolution time still counts as late"
    );
}
