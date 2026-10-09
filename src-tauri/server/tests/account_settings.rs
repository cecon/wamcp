//! Account settings, auto-resolve of inactive conversations and inbox assignment/CSAT extras.
mod common;

use common::{Fixture, Incoming};
use serde_json::json;

const DAY: i64 = 86_400;

#[tokio::test]
async fn administrators_configure_the_account() {
    let f = Fixture::new().await;
    f.session("Suporte");
    let admin = f.bootstrap().await;
    let maria = f.agent(&admin, "maria@example.com", "agent", true).await;
    let account = maria.get("/account").await.body;
    assert_eq!(
        (account["name"].as_str(), account["locale"].as_str()),
        (Some("Minha empresa"), Some("pt-BR"))
    );
    let changes = json!({ "name": "Cappyfy", "locale": "en", "auto_resolve_duration": 2,
        "auto_resolve_message": "Encerramos por inatividade. Qualquer coisa, é só chamar!" });
    assert_eq!(maria.patch("/account", changes.clone()).await.status, 403);
    let updated = admin.patch("/account", changes).await.body;
    assert_eq!(updated["name"], "Cappyfy");
    assert_eq!(updated["settings"]["auto_resolve_duration"], 2);
    for bad in [
        json!({ "auto_resolve_duration": 0 }),
        json!({ "locale": "fr" }),
        json!({ "name": "" }),
    ] {
        assert_eq!(admin.patch("/account", bad.clone()).await.status, 400, "{bad}");
    }
    let cleared = admin
        .patch("/account", json!({ "auto_resolve_duration": null }))
        .await
        .body;
    assert!(cleared["settings"]["auto_resolve_duration"].is_null());
    assert_eq!(
        cleared["settings"]["auto_resolve_message"]
            .as_str()
            .map(|m| m.len() > 10),
        Some(true)
    );
}

#[tokio::test]
async fn idle_conversations_are_resolved_automatically() {
    let f = Fixture::new().await;
    let session = f.session("Suporte");
    let admin = f.bootstrap().await;
    let helpdesk = f.app.state.support().helpdesk.clone();
    f.incoming(&session.id, Incoming::default());
    let other = Incoming {
        id: "IN2",
        jid: "5511900000002@s.whatsapp.net",
        ..Default::default()
    };
    f.incoming(&session.id, other);
    assert_eq!(helpdesk.auto_resolve().await.unwrap(), 0, "disabled by default");
    let settings = json!({ "auto_resolve_duration": 2, "auto_resolve_message": "Encerrando por inatividade." });
    admin.patch("/account", settings).await;
    f.tick(DAY);
    let busy = Incoming {
        id: "IN3",
        jid: "5511900000002@s.whatsapp.net",
        body: "ainda aqui",
        ..Default::default()
    };
    f.incoming(&session.id, busy);
    f.tick(DAY + 60);
    assert_eq!(helpdesk.auto_resolve().await.unwrap(), 1);
    let idle = admin.get("/conversations/1").await.body;
    assert_eq!(idle["status"], "resolved");
    assert_eq!(admin.get("/conversations/2").await.body["status"], "open");
    let sent: Vec<String> = f.wa.sent().iter().map(|s| s.text.clone()).collect();
    assert_eq!(sent, vec!["Encerrando por inatividade."]);
    let messages = admin.get("/conversations/1/messages").await.body;
    let activity = messages.as_array().unwrap().iter().any(|m| {
        m["message_type"] == "activity"
            && m["content"]
                .as_str()
                .unwrap_or_default()
                .contains("Resolução automática")
    });
    assert!(activity);
    assert_eq!(helpdesk.auto_resolve().await.unwrap(), 0);
}

#[tokio::test]
async fn inboxes_cap_assignments_and_customize_the_csat_survey() {
    let f = Fixture::new().await;
    let session = f.session("Suporte");
    let admin = f.bootstrap().await;
    let inbox = admin.get("/inboxes").await.body[0]["id"].as_i64().unwrap();
    let path = format!("/inboxes/{inbox}");
    assert_eq!(
        admin.patch(&path, json!({ "max_assignment_limit": 0 })).await.status,
        400
    );
    let changes = json!({ "enable_auto_assignment": true, "max_assignment_limit": 1, "csat_survey_enabled": true,
        "csat_survey_message": "De 1 a 5, como foi?" });
    let updated = admin.patch(&path, changes).await.body;
    assert_eq!(
        (
            updated["max_assignment_limit"].as_i64(),
            updated["csat_survey_message"].as_str()
        ),
        (Some(1), Some("De 1 a 5, como foi?"))
    );
    admin.patch("/profile", json!({ "availability": "online" })).await;
    f.incoming(&session.id, Incoming::default());
    let second = Incoming {
        id: "IN2",
        jid: "5511900000002@s.whatsapp.net",
        ..Default::default()
    };
    f.incoming(&session.id, second);
    assert_eq!(admin.get("/conversations/1").await.body["assignee_id"], admin.id());
    assert!(
        admin.get("/conversations/2").await.body["assignee_id"].is_null(),
        "limit of one open conversation"
    );
    admin
        .post("/conversations/1/toggle_status", json!({ "status": "resolved" }))
        .await;
    f.settle().await;
    assert!(f.wa.sent().iter().any(|s| s.text == "De 1 a 5, como foi?"));
    let cleared = admin
        .patch(
            &path,
            json!({ "max_assignment_limit": null, "csat_survey_message": null }),
        )
        .await
        .body;
    assert!(cleared["max_assignment_limit"].is_null() && cleared["csat_survey_message"].is_null());
}
