//! One listener for everyone: the WhatsApp connections API is for administrators, the first
//! administrator is created only on this computer, and the session cookie works over plain HTTP.
mod common;

use common::http::{request, Reply};
use common::{Fixture, PASSWORD};
use serde_json::json;

async fn raw(f: &Fixture, method: &str, path: &str, headers: &[(&str, &str)]) -> Reply {
    f.public(request(method, path, None, headers)).await
}

#[tokio::test]
async fn connections_api_is_for_administrators_only() {
    let f = Fixture::new().await;
    f.session("Suporte");
    assert_eq!(raw(&f, "GET", "/api/v1/status", &[]).await.status, 401);
    let admin = f.bootstrap().await;
    let maria = f.agent(&admin, "maria@example.com", "agent", true).await;
    let denied = maria.get("/sessions").await;
    assert_eq!(
        (denied.status, denied.body["error"].as_str()),
        (403, Some("Somente administradores podem fazer isso"))
    );
    assert_eq!(admin.get("/status").await.body["sessions"], 1);
    assert_eq!(admin.get("/sessions").await.body.as_array().unwrap().len(), 1);
    assert_eq!(admin.get("/unknown").await.status, 404);
    assert_eq!(
        raw(&f, "GET", "/api/sessions", &[]).await.status,
        404,
        "no second, token-based API"
    );
}

#[tokio::test]
async fn the_first_administrator_is_created_only_on_this_computer() {
    let f = Fixture::new().await;
    let network = [("x-forwarded-for", "192.168.0.20")];
    let status = raw(&f, "GET", "/api/helpdesk/status", &network).await.body;
    assert_eq!(
        (status["needsBootstrap"].clone(), status["local"].clone()),
        (json!(true), json!(false))
    );
    let body = json!({ "name": "Intruso", "email": "x@example.com", "password": PASSWORD });
    let tunnel = f
        .public(request(
            "POST",
            "/api/helpdesk/bootstrap",
            Some(body.clone()),
            &[("cf-connecting-ip", "1.2.3.4")],
        ))
        .await;
    assert_eq!(tunnel.status, 403);
    assert_eq!(raw(&f, "GET", "/api/helpdesk/status", &[]).await.body["local"], true);
    f.bootstrap().await;
    let again = f
        .public(request("POST", "/api/helpdesk/bootstrap", Some(body), &[]))
        .await;
    assert_eq!(again.status, 409);
    assert_eq!(
        raw(&f, "GET", "/api/helpdesk/status", &[]).await.body["needsBootstrap"],
        false
    );
}

#[tokio::test]
async fn the_session_cookie_is_secure_only_over_https() {
    let f = Fixture::new().await;
    f.bootstrap().await;
    let login = |headers: Vec<(&'static str, &'static str)>| {
        let f = &f;
        async move {
            let body = json!({ "email": "admin@example.com", "password": PASSWORD });
            let reply = f
                .public(request("POST", "/api/v1/auth/login", Some(body), &headers))
                .await;
            reply.header("set-cookie").unwrap_or_default()
        }
    };
    let lan = login(vec![]).await;
    assert!(lan.contains("HttpOnly") && !lan.contains("Secure"), "{lan}");
    let tunnel = login(vec![("cf-connecting-ip", "1.2.3.4")]).await;
    assert!(tunnel.contains("; Secure"), "{tunnel}");
    let proxy = login(vec![("x-forwarded-proto", "https")]).await;
    assert!(proxy.contains("; Secure"), "{proxy}");
}
