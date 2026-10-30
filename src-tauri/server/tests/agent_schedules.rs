//! AI agents subscribed to a schedule wake up and work by themselves through their runtime (a fake
//! here): the output goes to the chat of the agent with the person who created the schedule, the
//! tokens count in the agent's salary, each run is kept, missed runs happen once, a run still going
//! on is never doubled, and the system agent is never scheduled.
mod agents_support;
mod common;
mod schedules_support;

use agents_support::{ai, profiles};
use schedules_support::{hourly, setup};
use serde_json::{json, Value};
use wamcp_server::application::ports::{AgentChatRepo, AgentScheduleRepo, AgentsRepo};

#[tokio::test]
async fn subscribed_agents_run_on_schedule_and_report_in_the_creators_chat() {
    let s = setup(100).await;
    let start = s.f.now() * 1000;
    let schedule = s.create(hourly(s.ana)).await;
    assert_eq!(schedule["timezone"], "America/Sao_Paulo");
    assert_eq!(schedule["agent_ids"], json!([s.ana]));
    assert_eq!(schedule["next_run_at"], start + 3_600_000);
    assert!(s.schedules().run_due().unwrap().is_empty(), "not due yet");

    // Five hours with the app off: the missed runs happen once, not five times.
    s.f.tick(5 * 3600);
    assert_eq!(s.schedules().run_due().unwrap().len(), 1);
    s.f.settle().await;
    assert!(s.schedules().run_due().unwrap().is_empty());
    let listed = s.admin.get("/agent_schedules").await.body;
    assert_eq!(listed[0]["last_run_at"], s.f.now() * 1000);
    assert_eq!(listed[0]["next_run_at"], s.f.now() * 1000 + 3_600_000);

    let output = "Relatório 1: 3 conversas sem resposta.";
    assert_eq!(s.runs(&schedule).await, [("done".into(), Some(output.into()))]);
    let chat = s.chat().await;
    assert_eq!(chat.len(), 1);
    assert_eq!(chat[0].0, "agent");
    assert_eq!(chat[0].1, format!("⏰ Pendências\n\n{output}"));
    let request = s.runtime.requests.lock()[0].clone();
    assert!(request.prompt.contains("Tarefa agendada \"Pendências\""));
    assert!(
        request.prompt.contains("Atenda com cordialidade."),
        "the agent's instructions"
    );
    assert!(request.system.contains("tarefa agendada"));

    // The run is work: it counts in the agent's salary.
    let usage = s
        .admin
        .get(&format!("/agent_directory/{}/usage?days=30", s.ana))
        .await
        .body;
    assert_eq!(usage[0]["input_tokens"], 500);

    // The next run sees what the agent reported before, like a loop.
    s.f.tick(3600);
    s.schedules().run_due().unwrap();
    s.f.settle().await;
    let second = s.runtime.requests.lock()[1].clone();
    assert!(second.prompt.contains(output), "{}", second.prompt);
    assert_eq!(s.runs(&schedule).await.len(), 2);
}

#[tokio::test]
async fn a_run_still_going_on_is_skipped_not_doubled() {
    let s = setup(0).await;
    let schedule = s.create(hourly(s.ana)).await;
    let path = format!("/agent_schedules/{}/runs", schedule["id"]);
    let first = s.admin.post(&path, json!({})).await;
    assert_eq!(first.status, 201, "{:?}", first.body);
    assert_eq!(first.body[0]["status"], "running");
    let second = s.admin.post(&path, json!({})).await;
    assert_eq!(second.body[0]["status"], "skipped");
    assert!(second.body[0]["error"].as_str().unwrap().contains("ainda não terminou"));

    s.runtime.gate.add_permits(1);
    s.f.settle().await;
    let statuses: Vec<String> = s.runs(&schedule).await.into_iter().map(|r| r.0).collect();
    assert_eq!(statuses, ["skipped", "done"]);
    assert_eq!(s.runtime.requests.lock().len(), 1);
}

#[tokio::test]
async fn the_system_agent_is_never_scheduled_and_only_admins_manage_schedules() {
    let s = setup(100).await;
    let system = s.f.store.system_agent().unwrap().unwrap().id;
    let refused = s.admin.post("/agent_schedules", hourly(system)).await;
    assert_eq!(refused.status, 400);
    assert!(
        refused.body["error"].to_string().contains("funcionário do sistema"),
        "{:?}",
        refused.body
    );
    assert!(s
        .admin
        .get("/agent_schedules")
        .await
        .body
        .as_array()
        .unwrap()
        .is_empty());

    let schedule = s.create(hourly(s.ana)).await;
    let id = &schedule["id"];
    let subscribe = s
        .admin
        .put(&format!("/agent_schedules/{id}/agents/{system}"), json!({}))
        .await;
    assert_eq!(subscribe.status, 400);

    let maria = s.f.agent(&s.admin, "maria@loja.com", "agent", true).await;
    assert_eq!(maria.get("/agent_schedules").await.status, 403);
    assert_eq!(maria.post("/agent_schedules", hourly(s.ana)).await.status, 403);
    assert_eq!(
        maria
            .post(&format!("/agent_schedules/{id}/runs"), json!({}))
            .await
            .status,
        403
    );

    let removed = s
        .admin
        .del(&format!("/agent_schedules/{id}/agents/{}", s.ana), None)
        .await;
    assert_eq!(removed.body["agent_ids"], json!([]));
    let empty = s.admin.post(&format!("/agent_schedules/{id}/runs"), json!({})).await;
    assert_eq!(empty.status, 400, "nobody to run");
    assert_eq!(s.admin.del(&format!("/agent_schedules/{id}"), None).await.status, 200);
    assert_eq!(s.admin.get(&format!("/agent_schedules/{id}/runs")).await.status, 404);
}

#[tokio::test]
async fn cron_schedules_follow_the_time_zone_and_can_be_previewed_and_edited() {
    let s = setup(100).await;
    let weekdays = json!({ "cron": "0 9 * * 1-5" });
    let preview = s.admin.post("/agent_schedules/preview", weekdays).await;
    assert_eq!(preview.status, 200, "{:?}", preview.body);
    for at in preview.body.as_array().unwrap() {
        let at = chrono::DateTime::from_timestamp_millis(at.as_i64().unwrap()).unwrap();
        // 9h in São Paulo is 12h UTC; Saturdays and Sundays are skipped.
        assert_eq!(chrono::Timelike::hour(&at), 12);
        let day = chrono::Datelike::weekday(&at).num_days_from_monday();
        assert!(day < 5, "{at}");
    }
    let bad = s
        .admin
        .post("/agent_schedules/preview", json!({ "cron": "0 25 * * *" }))
        .await;
    assert_eq!(bad.status, 400);
    let both = json!({ "name": "X", "prompt": "Y", "cron": "* * * * *", "interval_minutes": 5 });
    assert_eq!(s.admin.post("/agent_schedules", both).await.status, 400);

    let mut body = hourly(s.ana);
    body["interval_minutes"] = Value::Null;
    body["cron"] = json!("0 9 * * 1-5");
    let schedule = s.create(body).await;
    assert_eq!(schedule["next_run_at"], preview.body[0]);
    let path = format!("/agent_schedules/{}", schedule["id"]);
    let edited = s
        .admin
        .patch(&path, json!({ "interval_minutes": 15, "active": false }))
        .await
        .body;
    assert_eq!(
        (edited["cron"].clone(), edited["interval_minutes"].clone()),
        (Value::Null, json!(15))
    );
    assert_eq!(edited["next_run_at"], s.f.now() * 1000 + 15 * 60_000);
    s.f.tick(3600);
    assert!(
        s.schedules().run_due().unwrap().is_empty(),
        "inactive schedules do not run"
    );
}

#[tokio::test]
async fn turned_off_agents_fail_their_run_and_unfinished_runs_fail_after_a_restart() {
    let s = setup(100).await;
    let schedule = s.create(hourly(s.ana)).await;
    let p = profiles(&s.admin).await;
    let mut off = ai(&p, "Ana", "operator");
    off["active"] = json!(false);
    let put = s.admin.put(&format!("/agent_directory/{}", s.ana), off).await;
    assert_eq!(put.status, 200, "{:?}", put.body);
    s.admin
        .post(&format!("/agent_schedules/{}/runs", schedule["id"]), json!({}))
        .await;
    s.f.settle().await;
    assert_eq!(s.runs(&schedule).await[0].0, "failed");
    let chat = s.f.store.agent_chat(s.admin.id(), s.ana).unwrap();
    let messages = s.f.store.chat_messages(chat.id, 10).unwrap();
    assert_eq!(
        messages[0].role, "error",
        "the agent is off, so its chat is hidden but keeps the error"
    );
    assert!(s.runtime.requests.lock().is_empty());

    let id = schedule["id"].as_i64().unwrap();
    let left = s.f.store.start_schedule_run(id, s.ana, "running", 0).unwrap();
    assert_eq!(s.schedules().recover().unwrap(), 1);
    let runs = s.admin.get(&format!("/agent_schedules/{id}/runs")).await.body;
    let after = runs
        .as_array()
        .unwrap()
        .iter()
        .find(|r| r["id"] == left.id)
        .unwrap()
        .clone();
    assert_eq!(after["status"], "failed");
    assert!(s.f.store.agent(s.ana).unwrap().is_some());
}
