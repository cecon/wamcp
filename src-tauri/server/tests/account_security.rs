//! Two-factor authentication, active sessions and the audit log.
mod common;

use common::http::Reply;
use common::{Agent, Fixture, PASSWORD};
use serde_json::{json, Value};
use wamcp_server::domain::totp::{base32_decode, code_at, STEP_SECONDS};

fn code(f: &Fixture, secret: &str) -> String {
    code_at(&base32_decode(secret).unwrap(), f.now().div_euclid(STEP_SECONDS))
}

async fn password_step(f: &Fixture, email: &str) -> Reply {
    let body = json!({ "email": email, "password": PASSWORD });
    f.api("POST", "/auth/login", Some(body), &[]).await
}

async fn second_step(f: &Fixture, token: &Value, code: &str) -> Reply {
    let body = json!({ "mfa_token": token, "code": code });
    f.api("POST", "/auth/mfa", Some(body), &[]).await
}

fn agent_from(f: &Fixture, reply: &Reply) -> Agent {
    let cookie = reply.header("set-cookie").unwrap_or_default();
    Agent {
        router: f.app.public_router(),
        cookie: cookie.split(';').next().unwrap_or_default().to_string(),
        csrf: reply.body["csrf"].as_str().unwrap_or_default().into(),
        user: reply.body["user"].clone(),
    }
}

/// An admin and an agent with two-factor on: (fixture, admin, agent, secret, backup codes).
async fn enrolled() -> (Fixture, Agent, Agent, String, Vec<String>) {
    let f = Fixture::new().await;
    let admin = f.bootstrap().await;
    let maria = f.agent(&admin, "maria@example.com", "agent", false).await;
    assert_eq!(maria.get("/profile/mfa").await.body["enabled"], false);
    let setup = maria.post("/profile/mfa", json!({})).await.body;
    let secret = setup["secret"].as_str().unwrap().to_string();
    let uri = setup["otpauth_uri"].as_str().unwrap();
    assert!(
        uri.starts_with("otpauth://totp/wamcp%3Amaria%40example.com?secret="),
        "{uri}"
    );
    assert_eq!(
        maria
            .post("/profile/mfa/verify", json!({ "code": "000000" }))
            .await
            .status,
        422
    );
    let enabled = maria
        .post("/profile/mfa/verify", json!({ "code": code(&f, &secret) }))
        .await
        .body;
    let backups: Vec<String> = serde_json::from_value(enabled["backup_codes"].clone()).unwrap();
    assert_eq!(backups.len(), 10);
    assert_eq!(maria.post("/profile/mfa", json!({})).await.status, 422);
    assert_eq!(maria.get("/profile/mfa").await.body["enabled"], true);
    (f, admin, maria, secret, backups)
}

#[tokio::test]
async fn two_factor_login_asks_for_a_fresh_code() {
    let (f, _admin, _maria, secret, _backups) = enrolled().await;

    let first = password_step(&f, "maria@example.com").await;
    assert_eq!(first.body["mfa_required"], true);
    assert!(first.header("set-cookie").is_none());
    let token = first.body["mfa_token"].clone();
    assert_eq!(second_step(&f, &token, "123456").await.status, 401);
    assert_eq!(
        second_step(&f, &token, &code(&f, &secret)).await.status,
        401,
        "a code is never reused"
    );
    f.tick(STEP_SECONDS);
    let signed = second_step(&f, &token, &code(&f, &secret)).await;
    assert_eq!(signed.status, 200);
    assert_eq!(agent_from(&f, &signed).get("/auth/me").await.status, 200);
    f.tick(STEP_SECONDS);
    assert_eq!(
        second_step(&f, &token, &code(&f, &secret)).await.status,
        401,
        "challenge consumed"
    );
}

#[tokio::test]
async fn a_challenge_accepts_five_codes_at_most() {
    let (f, _admin, _maria, secret, _backups) = enrolled().await;
    let token = password_step(&f, "maria@example.com").await.body["mfa_token"].clone();
    for _ in 0..5 {
        assert_eq!(second_step(&f, &token, "999999").await.status, 401);
    }
    f.tick(STEP_SECONDS);
    let status = second_step(&f, &token, &code(&f, &secret)).await.status;
    assert_eq!(status, 401, "too many attempts");
}

#[tokio::test]
async fn backup_codes_expiry_disabling_and_admin_reset() {
    let (f, admin, maria, secret, backups) = enrolled().await;
    let again = password_step(&f, "maria@example.com").await.body["mfa_token"].clone();
    assert_eq!(second_step(&f, &again, &backups[0].to_uppercase()).await.status, 200);
    let third = password_step(&f, "maria@example.com").await.body["mfa_token"].clone();
    assert_eq!(
        second_step(&f, &third, &backups[0]).await.status,
        401,
        "backup codes are single use"
    );
    let late = password_step(&f, "maria@example.com").await.body["mfa_token"].clone();
    f.tick(301);
    assert_eq!(second_step(&f, &late, &code(&f, &secret)).await.status, 401, "expired");

    let wrong_password = json!({ "password": "errada-123456", "code": code(&f, &secret) });
    assert_eq!(maria.del("/profile/mfa", Some(wrong_password)).await.status, 422);
    let wrong_code = json!({ "password": PASSWORD, "code": "000000" });
    assert_eq!(maria.del("/profile/mfa", Some(wrong_code)).await.status, 422);
    f.tick(STEP_SECONDS);
    let off = json!({ "password": PASSWORD, "code": code(&f, &secret) });
    assert_eq!(maria.del("/profile/mfa", Some(off)).await.status, 200);
    assert!(password_step(&f, "maria@example.com")
        .await
        .header("set-cookie")
        .is_some());

    let secret = maria.post("/profile/mfa", json!({})).await.body["secret"]
        .as_str()
        .unwrap()
        .to_string();
    maria
        .post("/profile/mfa/verify", json!({ "code": code(&f, &secret) }))
        .await;
    let path = format!("/agents/{}/mfa", maria.id());
    assert_eq!(maria.del(&path, None).await.status, 403);
    assert_eq!(admin.del(&path, None).await.status, 200);
    assert!(password_step(&f, "maria@example.com")
        .await
        .header("set-cookie")
        .is_some());
}

#[tokio::test]
async fn agents_review_and_revoke_their_sessions() {
    let f = Fixture::new().await;
    let admin = f.bootstrap().await;
    let maria = f.agent(&admin, "maria@example.com", "agent", false).await;
    let laptop = f.login("maria@example.com", PASSWORD).await.unwrap();
    let phone = f.login("maria@example.com", PASSWORD).await.unwrap();
    let sessions = maria.get("/profile/sessions").await.body;
    let list = sessions.as_array().unwrap();
    assert_eq!(list.len(), 3);
    assert_eq!(list.iter().filter(|s| s["current"] == true).count(), 1);
    let other = list.iter().find(|s| s["current"] == false).unwrap()["id"]
        .as_str()
        .unwrap()
        .to_string();
    assert_eq!(maria.del(&format!("/profile/sessions/{other}"), None).await.status, 200);
    assert_eq!(maria.del(&format!("/profile/sessions/{other}"), None).await.status, 404);
    assert_eq!(maria.del("/profile/sessions/curto", None).await.status, 400);
    let mine = list[0]["id"].as_str().unwrap();
    assert_eq!(admin.del(&format!("/profile/sessions/{mine}"), None).await.status, 404);
    assert_eq!(maria.del("/profile/sessions", None).await.status, 200);
    assert_eq!(maria.get("/profile/sessions").await.body.as_array().unwrap().len(), 1);
    assert_eq!(laptop.get("/auth/me").await.status, 401);
    assert_eq!(phone.get("/auth/me").await.status, 401);
}

#[tokio::test]
async fn administrative_changes_are_audited() {
    let f = Fixture::new().await;
    let session = f.session("Suporte");
    let admin = f.bootstrap().await;
    let maria = f.agent(&admin, "maria@example.com", "agent", true).await;
    let label = admin.post("/labels", json!({ "title": "vip" })).await.body;
    let label_path = format!("/labels/{}", label["id"]);
    admin.patch(&label_path, json!({ "color": "#ff0000" })).await;
    admin.del(&label_path, None).await;
    admin.post("/labels", json!({ "title": "" })).await;
    f.incoming(&session.id, common::Incoming::default());
    maria
        .post("/conversations/1/messages", json!({ "content": "oi" }))
        .await;
    admin.del("/conversations/1", None).await;
    assert_eq!(maria.get("/audit_logs").await.status, 403);
    assert_eq!(admin.get("/audit_logs?page=0").await.status, 400);
    let logs = admin.get("/audit_logs").await.body;
    let entries: Vec<String> = logs
        .as_array()
        .unwrap()
        .iter()
        .map(|l| {
            let who = l["user_name"].as_str().unwrap_or("-");
            format!(
                "{} {} {who}",
                l["action"].as_str().unwrap(),
                l["auditable_type"].as_str().unwrap()
            )
        })
        .collect();
    assert_eq!(
        entries,
        vec![
            "delete conversation Admin",
            "delete label Admin",
            "update label Admin",
            "create label Admin",
            "sign_in user maria",
            "create user Admin",
            "sign_in user Admin",
        ]
    );
    assert_eq!(logs[1]["details"]["path"], label_path);
    assert_eq!(logs[1]["auditable_id"], label["id"]);
}
