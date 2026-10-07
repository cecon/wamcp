//! Macros and the extended automation rules (conversation_updated, new conditions and actions).
mod common;

use common::{Fixture, Incoming};
use serde_json::{json, Value};

fn action(name: &str, params: Value) -> Value {
    json!({ "action_name": name, "action_params": params })
}

#[tokio::test]
async fn agents_run_personal_and_global_macros() {
    let f = Fixture::new().await;
    let session = f.session("Suporte");
    let admin = f.bootstrap().await;
    let maria = f.agent(&admin, "maria@example.com", "agent", true).await;
    let jose = f.agent(&admin, "jose@example.com", "agent", true).await;
    for (id, jid) in [
        ("IN1", "5511900000001@s.whatsapp.net"),
        ("IN2", "5511900000002@s.whatsapp.net"),
    ] {
        f.incoming(
            &session.id,
            Incoming {
                id,
                jid,
                ..Default::default()
            },
        );
    }
    admin.post("/labels", json!({ "title": "vip" })).await;
    let actions = json!([
        action("add_label", json!(["vip"])),
        action("change_priority", json!(["high"])),
        action("send_message", json!(["Já estamos verificando!"])),
        action("assign_agent", json!([maria.id()])),
        action("resolve_conversation", json!([])),
    ]);
    let personal = maria
        .post("/macros", json!({ "name": "Triagem VIP", "actions": actions }))
        .await;
    assert_eq!(personal.status, 201);
    assert_eq!(
        (
            personal.body["visibility"].as_str(),
            personal.body["created_by_name"].as_str()
        ),
        (Some("personal"), Some("maria"))
    );
    let global =
        json!({ "name": "Encerrar", "visibility": "global", "actions": [action("resolve_conversation", json!([]))] });
    assert_eq!(maria.post("/macros", global.clone()).await.status, 403);
    let global = admin.post("/macros", global).await.body;
    let invalid = [
        json!({ "name": "Sem ações", "actions": [] }),
        json!({ "name": "Ruim", "actions": [action("explode", json!([]))] }),
        json!({ "name": "Sem param", "actions": [action("add_label", json!([]))] }),
        json!({ "actions": [action("resolve_conversation", json!([]))] }),
        json!({ "name": "x", "visibility": "team", "actions": [action("resolve_conversation", json!([]))] }),
    ];
    for body in invalid {
        assert_eq!(maria.post("/macros", body.clone()).await.status, 400, "{body}");
    }
    assert_eq!(maria.get("/macros").await.body.as_array().unwrap().len(), 2);
    assert_eq!(jose.get("/macros").await.body.as_array().unwrap().len(), 1);

    let run = format!("/macros/{}/execute", personal.body["id"]);
    let result = maria.post(&run, json!({ "conversation_ids": [1, 2, 99] })).await.body;
    assert_eq!(result["updated"], json!([1, 2]));
    assert_eq!(result["failed"][0]["id"], 99);
    let c = admin.get("/conversations/1").await.body;
    assert_eq!(
        json!([c["labels"], c["priority"], c["assignee_id"], c["status"]]),
        json!([["vip"], "high", maria.id(), "resolved"])
    );
    assert_eq!(f.wa.sent().len(), 2);
    assert_eq!(jose.post(&run, json!({ "conversation_ids": [1] })).await.status, 404);
    assert_eq!(maria.post(&run, json!({ "conversation_ids": [] })).await.status, 400);

    let global_path = format!("/macros/{}", global["id"]);
    assert_eq!(maria.patch(&global_path, json!({ "name": "Meu" })).await.status, 403);
    assert_eq!(
        admin.patch(&global_path, json!({ "name": "Fechar" })).await.body["name"],
        "Fechar"
    );
    let personal_path = format!("/macros/{}", personal.body["id"]);
    assert_eq!(jose.patch(&personal_path, json!({ "name": "x" })).await.status, 404);
    assert_eq!(
        maria
            .patch(&personal_path, json!({ "visibility": "global" }))
            .await
            .status,
        403
    );
    let renamed = maria
        .patch(
            &personal_path,
            json!({ "actions": [action("open_conversation", json!([]))] }),
        )
        .await;
    assert_eq!(renamed.body["actions"][0]["action_name"], "open_conversation");
    assert_eq!(maria.patch(&personal_path, json!({ "actions": [] })).await.status, 400);
    assert_eq!(maria.del(&personal_path, None).await.status, 200);
    assert_eq!(maria.del(&global_path, None).await.status, 403);
    assert_eq!(admin.del(&global_path, None).await.status, 200);
}

#[tokio::test]
async fn automations_react_to_updates_custom_attributes_and_new_actions() {
    let f = Fixture::new().await;
    let session = f.session("Suporte");
    let admin = f.bootstrap().await;
    let maria = f.agent(&admin, "maria@example.com", "agent", true).await;
    admin.post("/labels", json!({ "title": "urgente" })).await;
    let rule = json!({
        "name": "Urgentes",
        "event_name": "conversation_updated",
        "conditions": [
            { "attribute_key": "priority", "filter_operator": "equal_to", "values": ["urgent"], "query_operator": "and" },
            { "attribute_key": "custom_attribute:plano", "filter_operator": "starts_with", "values": ["pre"] },
        ],
        "actions": [
            action("add_label", json!(["urgente"])),
            action("remove_assigned_agent", json!([])),
            action("pending_conversation", json!([])),
        ],
    });
    let created = admin.post("/automation_rules", rule).await;
    assert_eq!(created.status, 201, "{}", created.text);
    let bad_key = json!({ "name": "x", "event_name": "conversation_updated",
        "conditions": [{ "attribute_key": "custom_attribute:", "filter_operator": "is_present" }],
        "actions": [action("mute_conversation", json!([]))] });
    assert_eq!(admin.post("/automation_rules", bad_key).await.status, 400);
    f.incoming(&session.id, Incoming::default());
    admin
        .post("/conversations/1/assignments", json!({ "assignee_id": maria.id() }))
        .await;
    admin
        .post(
            "/conversations/1/custom_attributes",
            json!({ "custom_attributes": { "plano": "premium" } }),
        )
        .await;
    f.settle().await;
    assert_eq!(
        admin.get("/conversations/1").await.body["labels"],
        json!([]),
        "priority not urgent yet"
    );
    admin
        .post("/conversations/1/toggle_priority", json!({ "priority": "urgent" }))
        .await;
    f.settle().await;
    let c = admin.get("/conversations/1").await.body;
    assert_eq!(
        json!([c["labels"], c["assignee_id"], c["status"]]),
        json!([["urgente"], null, "pending"])
    );

    let copy = admin
        .post(&format!("/automation_rules/{}/clone", created.body["id"]), json!({}))
        .await;
    assert_eq!(copy.status, 201);
    assert_eq!(
        (copy.body["name"].as_str(), copy.body["active"].as_i64()),
        (Some("Urgentes (cópia)"), Some(0))
    );
    assert_eq!(copy.body["conditions"], created.body["conditions"]);
    assert_eq!(
        maria
            .post(&format!("/automation_rules/{}/clone", created.body["id"]), json!({}))
            .await
            .status,
        403
    );
    assert_eq!(admin.post("/automation_rules/999/clone", json!({})).await.status, 404);

    let mute = json!({ "name": "Silenciar spam", "event_name": "message_created",
        "conditions": [{ "attribute_key": "content", "filter_operator": "starts_with", "values": ["promo"] }],
        "actions": [action("snooze_conversation", json!([])), action("mute_conversation", json!([]))] });
    admin.post("/automation_rules", mute).await;
    f.incoming(
        &session.id,
        Incoming {
            id: "IN9",
            jid: "5511900000009@s.whatsapp.net",
            body: "PROMOÇÃO imperdível",
            ..Default::default()
        },
    );
    f.settle().await;
    let spam = admin.get("/conversations/2").await.body;
    assert_eq!(
        (spam["muted"].as_i64(), spam["status"].as_str()),
        (Some(1), Some("resolved"))
    );
}
