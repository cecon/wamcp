//! Helpdesk phase 3: working hours and auto-replies, CSAT surveys and reports.
mod common;

use common::{Agent, Fixture, Incoming, PASSWORD};
use serde_json::{json, Value};
use wamcp_server::domain::model::Session;

async fn setup() -> (Fixture, Session, Agent, Value) {
    let f = Fixture::new().await;
    let session = f.session("Suporte");
    let admin = f.bootstrap().await;
    let inbox = admin.get("/inboxes").await.body[0]["id"].clone();
    (f, session, admin, inbox)
}

fn sent_texts(f: &Fixture) -> Vec<String> {
    f.wa.sent().into_iter().map(|m| m.text).collect()
}

/// JSON numbers compared by value, as in JavaScript: SQLite AVG() yields REAL, serialized as `120.0`.
fn numeric(value: Value) -> Value {
    match value {
        Value::Number(n) => match n.as_f64() {
            Some(x) if n.is_f64() && x.fract() == 0.0 => json!(x as i64),
            _ => Value::Number(n),
        },
        Value::Array(items) => Value::Array(items.into_iter().map(numeric).collect()),
        Value::Object(map) => Value::Object(map.into_iter().map(|(k, v)| (k, numeric(v))).collect()),
        other => other,
    }
}

fn last_sent(f: &Fixture) -> String {
    f.wa.sent().last().map(|m| m.text.clone()).unwrap_or_default()
}

#[tokio::test]
async fn greeting_and_out_of_office_messages_follow_working_hours() {
    let (f, session, admin, inbox) = setup().await;
    let closed: Vec<Value> = (0..7)
        .map(|d| json!({ "day_of_week": d, "closed_all_day": true, "open_minutes": 0, "close_minutes": 0 }))
        .collect();
    let hours_path = format!("/inboxes/{inbox}/working_hours");
    let inbox_path = format!("/inboxes/{inbox}");
    let duplicated = json!({ "working_hours": [closed[0], closed[0]] });
    assert_eq!(admin.put(&hours_path, duplicated).await.status, 400);
    assert_eq!(
        admin
            .patch(&inbox_path, json!({ "timezone": "Mars/Olympus" }))
            .await
            .status,
        400
    );
    admin.put(&hours_path, json!({ "working_hours": closed })).await;
    let settings = json!({
        "greeting_enabled": true,
        "greeting_message": "Olá! Recebemos sua mensagem.",
        "working_hours_enabled": true,
        "out_of_office_message": "Estamos fora do horário.",
    });
    admin.patch(&inbox_path, settings).await;
    f.incoming(
        &session.id,
        Incoming {
            id: "IN1",
            ..Default::default()
        },
    );
    f.settle().await;
    assert_eq!(
        sent_texts(&f),
        vec!["Olá! Recebemos sua mensagem.", "Estamos fora do horário."]
    );
    let messages = admin.get("/conversations/1/messages").await.body;
    let last = messages.as_array().and_then(|m| m.last()).cloned().unwrap_or_default();
    assert_eq!(last["content_attributes"]["automated"], "Fora do horário");
    let first_reply = admin.get("/conversations/1").await.body["first_reply_at"].clone();
    assert_eq!(first_reply, Value::Null, "automatic messages are not replies");

    let open: Vec<Value> = closed
        .iter()
        .map(|d| {
            let mut day = d.clone();
            day["closed_all_day"] = json!(false);
            day["open_minutes"] = json!(0);
            day["close_minutes"] = json!(1440);
            day
        })
        .collect();
    let saved = admin.put(&hours_path, json!({ "working_hours": open })).await.body;
    assert_eq!(saved.as_array().map(Vec::len), Some(7));
    assert_eq!(admin.get(&hours_path).await.body[0]["close_minutes"], 1440);
    f.incoming(
        &session.id,
        Incoming {
            id: "IN2",
            jid: "5511900000000@s.whatsapp.net",
            ..Default::default()
        },
    );
    f.settle().await;
    assert_eq!(
        last_sent(&f),
        "Olá! Recebemos sua mensagem.",
        "no out-of-office during open hours"
    );
}

#[tokio::test]
async fn csat_survey_is_sent_on_resolution_and_the_rating_is_recorded_without_reopening() {
    let (f, session, admin, inbox) = setup().await;
    admin
        .patch(&format!("/inboxes/{inbox}"), json!({ "csat_survey_enabled": true }))
        .await;
    f.incoming(
        &session.id,
        Incoming {
            id: "IN1",
            ..Default::default()
        },
    );
    admin
        .post("/conversations/1/assignments", json!({ "assignee_id": admin.id() }))
        .await;
    admin
        .post("/conversations/1/toggle_status", json!({ "status": "resolved" }))
        .await;
    f.settle().await;
    assert!(last_sent(&f).contains("nota de 1"), "{}", last_sent(&f));
    f.incoming(
        &session.id,
        Incoming {
            id: "IN2",
            body: "5 - ótimo atendimento",
            ..Default::default()
        },
    );
    f.settle().await;
    assert_eq!(admin.get("/conversations/1").await.body["status"], "resolved");
    assert_eq!(last_sent(&f), "Obrigado pela avaliação!");
    let csat = admin.get("/csat_responses").await.body[0].clone();
    assert_eq!(
        json!([csat["rating"], csat["feedback"], csat["assignee_name"]]),
        json!([5, "ótimo atendimento", "Admin"])
    );
    f.incoming(
        &session.id,
        Incoming {
            id: "IN3",
            body: "outra coisa",
            ..Default::default()
        },
    );
    assert_eq!(
        admin.get("/conversations/1").await.body["status"],
        "open",
        "non-ratings reopen as usual"
    );
}

#[tokio::test]
async fn reports_aggregate_first_response_resolution_volume_and_csat_per_agent() {
    let (f, session, admin, _) = setup().await;
    let maria = json!({ "name": "Maria", "email": "maria@example.com", "password": PASSWORD, "inbox_ids": [1] });
    admin.post("/agents", maria).await;
    let maria = f.login("maria@example.com", PASSWORD).await.expect("maria login");
    let since = f.now() - 10;
    f.incoming(
        &session.id,
        Incoming {
            id: "IN1",
            ..Default::default()
        },
    );
    f.tick(120);
    maria
        .post("/conversations/1/messages", json!({ "content": "Oi!" }))
        .await;
    f.tick(60);
    maria
        .post("/conversations/1/messages", json!({ "content": "Algo mais?" }))
        .await;
    f.tick(300);
    maria
        .post("/conversations/1/toggle_status", json!({ "status": "resolved" }))
        .await;
    f.settle().await;
    assert_eq!(maria.get("/reports/summary").await.status, 403);
    let until = f.now() + 1;
    let summary = numeric(
        admin
            .get(&format!("/reports/summary?since={since}&until={until}"))
            .await
            .body,
    );
    assert_eq!(summary["first_response"], json!({ "count": 1, "average": 120 }));
    assert_eq!(summary["resolutions"], json!({ "count": 1, "average": 480 }));
    assert_eq!(summary["incoming_messages"], 1);
    assert_eq!(summary["outgoing_messages"], 2);
    let agents = numeric(
        admin
            .get(&format!("/reports/agents?since={since}&until={until}&inbox_id=1"))
            .await
            .body,
    );
    let row = agents
        .as_array()
        .and_then(|a| a.iter().find(|a| a["name"] == "Maria"))
        .cloned()
        .expect("Maria row");
    assert_eq!(
        json!([row["resolved"], row["avg_first_response"], row["avg_resolution"]]),
        json!([1, 120, 480])
    );
    let empty = admin.get("/reports/summary?since=1&until=2").await.body;
    assert_eq!(empty["first_response"]["count"], 0);

    let priority = maria
        .post("/conversations/1/toggle_priority", json!({ "priority": "urgent" }))
        .await;
    assert_eq!(priority.body["priority"], "urgent");
    let again = maria
        .post("/conversations/1/toggle_priority", json!({ "priority": "urgent" }))
        .await;
    assert_eq!(again.body["priority"], "urgent");
}
