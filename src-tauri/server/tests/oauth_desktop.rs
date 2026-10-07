//! OAuth for the desktop app: PKCE with an exact loopback callback binding
//! (port of `tests/oauth-desktop.test.mjs`).
mod common;
mod oauth_flow;

use common::ORIGIN;
use oauth_flow::{pairs, query_param, str_of, with, Flow};
use serde_json::json;

#[tokio::test]
async fn desktop_oauth_completes_with_pkce_and_exact_loopback_callback_binding() {
    let f = Flow::new().await;
    let redirect_uri = "http://127.0.0.1:49152/callback/bnDWLth3djIC";
    let registered = f
        .register(json!({ "redirect_uris": [redirect_uri], "client_name": "Codex desktop" }))
        .await;
    assert_eq!(registered.status, 201);
    let client = str_of(&registered.body, "client_id");
    let flow = f.begin(&client, &[("redirect_uri", Some(redirect_uri))]).await;
    assert_eq!(flow.reply.status, 200, "{}", flow.reply.text);
    let link = str_of(&f.oauth().create_link(&f.a.id, "read").unwrap(), "code");
    let request = flow.request.clone().unwrap_or_default();
    let approved = f
        .approve_form(&pairs(&[("request", &request), ("code", &link)]), ORIGIN)
        .await;
    assert_eq!(approved.status, 303);
    let location = approved.header("location").unwrap_or_default();
    let redirect = url::Url::parse(&location).expect("location");
    assert_eq!(
        format!("{}{}", redirect.origin().ascii_serialization(), redirect.path()),
        redirect_uri
    );
    let code = query_param(&location, "code").unwrap_or_default();
    let body = pairs(&[
        ("grant_type", "authorization_code"),
        ("client_id", &client),
        ("code", &code),
        ("code_verifier", &flow.verifier),
        ("redirect_uri", redirect_uri),
        ("resource", &f.resource),
    ]);
    let other_port = with(&body, &[("redirect_uri", "http://127.0.0.1:49153/callback")]);
    assert_eq!(f.token(&other_port).await.status, 400);
    let verifier = "x".repeat(43);
    assert_eq!(f.token(&with(&body, &[("code_verifier", &verifier)])).await.status, 400);
    let response = f.token(&body).await;
    assert_eq!(response.status, 200);
    assert_eq!(response.body["scope"], "whatsapp:read");
    let access = str_of(&response.body, "access_token");
    assert_eq!(f.rpc(&access, "get_profile").await.status, 200);
    assert_eq!(f.rpc_with(&access, "get_profile", &f.b, json!({})).await.status, 401);
}

#[tokio::test]
async fn desktop_callbacks_reject_remote_hosts_credentials_queries_and_unrelated_paths() {
    let f = Flow::new().await;
    for redirect in [
        "http://127.0.0.1/callback",
        "http://127.0.0.1:49152/other",
        "http://127.0.0.1:49152/callback/nonce/extra",
        "http://127.0.0.1:49152/callback/%2F",
        "http://127.0.0.1.evil.example:49152/callback",
        "http://192.168.1.1:49152/callback",
        "http://user@127.0.0.1:49152/callback",
        "http://127.0.0.1:49152/callback?next=evil",
        "http://127.0.0.1:49152/callback#fragment",
    ] {
        assert_eq!(
            f.register(json!({ "redirect_uris": [redirect] })).await.status,
            400,
            "{redirect}"
        );
    }
}
