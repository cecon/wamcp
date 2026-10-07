//! Reports v2: series, summaries with comparison, breakdowns, CSAT metrics/export and bot metrics.
mod common;

use common::{Agent, Fixture, Incoming};
use serde_json::{json, Value};
use wamcp_server::domain::reports::{bucket_start, buckets, percent};

const DAY: i64 = 86_400;

/// Day 1: a conversation answered after 2 minutes, labelled vip, resolved and rated 5.
/// Day 2: an unanswered conversation.
async fn history() -> (Fixture, Agent, i64) {
    let f = Fixture::new().await;
    let session = f.session("Suporte");
    let admin = f.bootstrap().await;
    let inbox = admin.get("/inboxes").await.body[0]["id"].as_i64().unwrap();
    admin
        .patch(&format!("/inboxes/{inbox}"), json!({ "csat_survey_enabled": true }))
        .await;
    admin.post("/labels", json!({ "title": "vip" })).await;
    let start = f.now();
    f.incoming(&session.id, Incoming::default());
    f.tick(120);
    admin
        .post("/conversations/1/assignments", json!({ "assignee_id": admin.id() }))
        .await;
    admin
        .post("/conversations/1/messages", json!({ "content": "Olá!" }))
        .await;
    admin
        .post("/conversations/1/labels", json!({ "labels": ["vip"] }))
        .await;
    admin
        .post("/conversations/1/toggle_status", json!({ "status": "resolved" }))
        .await;
    f.settle().await;
    let rating = Incoming {
        id: "IN2",
        body: "5 - ótimo atendimento",
        ..Default::default()
    };
    f.incoming(&session.id, rating);
    f.settle().await;
    f.tick(DAY);
    let second = Incoming {
        id: "IN3",
        jid: "5511900000002@s.whatsapp.net",
        ..Default::default()
    };
    f.incoming(&session.id, second);
    (f, admin, start)
}

fn values(series: &Value) -> Vec<f64> {
    series
        .as_array()
        .unwrap()
        .iter()
        .map(|p| p["value"].as_f64().unwrap())
        .collect()
}

#[tokio::test]
async fn series_and_summaries_by_dimension() {
    let (f, admin, start) = history().await;
    let since = bucket_start(start, "day");
    let range = format!("since={since}&until={}", since + 3 * DAY);
    let daily = admin
        .get(&format!("/reports?metric=conversations_count&{range}"))
        .await
        .body;
    assert_eq!(values(&daily), vec![1.0, 1.0, 0.0]);
    assert_eq!(daily[0]["timestamp"], since);
    let weekly = admin
        .get(&format!(
            "/reports?metric=incoming_messages_count&group_by=week&{range}"
        ))
        .await
        .body;
    assert_eq!(weekly[0]["timestamp"], bucket_start(start, "week"));
    assert_eq!(values(&weekly).iter().sum::<f64>(), 3.0);

    let summary = admin.get(&format!("/reports/summary_v2?{range}")).await.body;
    assert_eq!(
        summary["conversations_count"],
        json!({ "current": 2.0, "previous": 0.0 })
    );
    assert_eq!(summary["avg_first_response_time"]["current"], 120.0);
    assert_eq!(summary["resolutions_count"]["current"], 1.0);
    let vip = admin
        .get(&format!("/reports/summary_v2?type=label&label=vip&{range}"))
        .await
        .body;
    assert_eq!(vip["conversations_count"]["current"], 1.0);
    let agent = format!("/reports/summary_v2?type=agent&id={}&{range}", admin.id());
    let mine = admin.get(&agent).await.body;
    assert_eq!(
        mine["outgoing_messages_count"]["current"], 1.0,
        "only the agent's own replies"
    );
    assert_eq!(mine["conversations_count"]["current"], 1.0);

    let inboxes = admin.get(&format!("/reports/breakdown/inbox?{range}")).await.body;
    assert_eq!(
        (inboxes[0]["name"].as_str(), inboxes[0]["conversations_count"].as_f64()),
        (Some("Suporte"), Some(2.0))
    );
    let labels = admin.get(&format!("/reports/breakdown/label?{range}")).await.body;
    assert_eq!(
        (labels[0]["name"].as_str(), labels[0]["resolutions_count"].as_f64()),
        (Some("vip"), Some(1.0))
    );
    let agents = admin.get(&format!("/reports/breakdown/agent?{range}")).await.body;
    assert_eq!(agents[0]["avg_first_response_time"], 120.0);
    assert_eq!(
        admin.get(&format!("/reports/breakdown/team?{range}")).await.body,
        json!([])
    );
}

#[tokio::test]
async fn csat_and_bot_metrics_and_validation() {
    let (f, admin, start) = history().await;
    let range = format!("since={}&until={}", start - DAY, f.now() + 1);
    let csat = admin.get(&format!("/csat_survey_responses/metrics?{range}")).await.body;
    assert_eq!(
        json!([
            csat["total"],
            csat["sent"],
            csat["ratings"]["5"],
            csat["average"],
            csat["satisfaction_score"],
            csat["response_rate"]
        ]),
        json!([1, 1, 1, 5.0, 100.0, 100.0])
    );
    let csv = admin.get(&format!("/csat_survey_responses/download?{range}")).await;
    assert!(csv.header("content-disposition").unwrap().contains("csat.csv"));
    let lines: Vec<&str> = csv.text.lines().collect();
    assert_eq!(lines[0], "conversa,contato,agente,nota,comentario,data");
    assert!(
        lines[1].starts_with("1,Cliente,Admin,5,ótimo atendimento,"),
        "{}",
        lines[1]
    );
    let bots = admin.get(&format!("/reports/bots?{range}")).await.body;
    assert_eq!(
        (bots["conversations"].as_i64(), bots["resolution_rate"].clone()),
        (Some(0), Value::Null)
    );

    let maria = f.agent(&admin, "maria@example.com", "agent", true).await;
    assert_eq!(maria.get("/reports/summary_v2").await.status, 403);
    let invalid = [
        "/reports",
        "/reports?metric=bogus",
        "/reports?metric=conversations_count&group_by=year",
        "/reports/summary_v2?type=inbox",
        "/reports/summary_v2?since=10&until=5",
        "/reports/summary_v2?since=0&until=99999999",
        "/reports/breakdown/country",
    ];
    for path in invalid {
        assert_eq!(admin.get(path).await.status, 400, "{path}");
    }
}

#[test]
fn buckets_cover_the_period_without_gaps() {
    let friday = 1_800_000_000; // 2027-01-15 08:00 UTC
    let monday = bucket_start(friday, "week");
    assert_eq!(
        chrono::DateTime::from_timestamp(monday, 0)
            .unwrap()
            .format("%a %F %T")
            .to_string(),
        "Mon 2027-01-11 00:00:00"
    );
    let month = bucket_start(friday, "month");
    assert_eq!(
        chrono::DateTime::from_timestamp(month, 0)
            .unwrap()
            .format("%F")
            .to_string(),
        "2027-01-01"
    );
    let months = buckets(friday, friday + 60 * DAY, "month");
    assert_eq!(months.len(), 3);
    assert_eq!(
        chrono::DateTime::from_timestamp(months[1], 0)
            .unwrap()
            .format("%F")
            .to_string(),
        "2027-02-01"
    );
    assert_eq!(buckets(friday, friday + 1, "day").len(), 1);
    assert_eq!(buckets(friday, friday + 3 * 7 * DAY, "week").len(), 4);
    assert_eq!((percent(1, 3), percent(1, 0)), (Some(33.3), None));
}

#[tokio::test]
async fn bot_metrics_count_resolutions_and_handoffs() {
    let f = Fixture::new().await;
    let session = f.session("Suporte");
    let admin = f.bootstrap().await;
    let inbox = admin.get("/inboxes").await.body[0]["id"].as_i64().unwrap();
    admin
        .patch(&format!("/inboxes/{inbox}"), json!({ "agent_bot_enabled": true }))
        .await;
    let helpdesk = f.app.state.support().helpdesk.clone();
    let bot = helpdesk.bot_for(&session.id).unwrap();
    f.incoming(&session.id, Incoming::default());
    let other = Incoming {
        id: "IN2",
        jid: "5511900000002@s.whatsapp.net",
        ..Default::default()
    };
    f.incoming(&session.id, other);
    helpdesk
        .reply(&bot, 1, "Resolvido pelo assistente", false)
        .await
        .unwrap();
    helpdesk.toggle_status(&bot, 1, "resolved", None).unwrap();
    helpdesk.reply(&bot, 2, "Vou chamar um atendente", false).await.unwrap();
    admin
        .post("/conversations/2/messages", json!({ "content": "Oi, sou a Ana" }))
        .await;
    let range = format!("since={}&until={}", f.now() - DAY, f.now() + 1);
    let bots = admin.get(&format!("/reports/bots?{range}")).await.body;
    assert_eq!(
        json!([
            bots["conversations"],
            bots["resolutions"],
            bots["handoffs"],
            bots["resolution_rate"],
            bots["handoff_rate"]
        ]),
        json!([2, 1, 1, 50.0, 50.0])
    );
}
