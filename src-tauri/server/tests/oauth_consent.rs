//! OAuth for ChatGPT: unsafe callbacks, PKCE/client/audience/scope checks and the local consent
//! proof (port of `tests/oauth.test.mjs`).
mod common;
mod oauth_flow;

use common::ORIGIN;
use oauth_flow::{pairs, query_param, str_of, with, Flow, CALLBACK};
use serde_json::json;

#[tokio::test]
async fn rejects_unsafe_callbacks_missing_resource_bad_pkce_client_audience_and_escalation() {
    let f = Flow::new().await;
    for redirect in [
        "https://evil.example/callback".to_string(),
        "http://chatgpt.com/connector/oauth/id".into(),
        "https://chatgpt.com.evil.example/connector/oauth/id".into(),
        format!("{CALLBACK}?next=https://evil.example"),
    ] {
        assert_eq!(
            f.register(json!({ "redirect_uris": [redirect] })).await.status,
            400,
            "{redirect}"
        );
    }
    let client = str_of(&f.register(json!({})).await.body, "client_id");
    let other = str_of(&f.register(json!({})).await.body, "client_id");
    assert_eq!(
        f.register(json!({ "token_endpoint_auth_method": "private_key_jwt" }))
            .await
            .status,
        400
    );
    let missing = f.begin(&client, &[("resource", Some(ORIGIN))]).await;
    assert_eq!(missing.reply.status, 302);
    let location = missing.reply.header("location").unwrap_or_default();
    assert_eq!(query_param(&location, "error").as_deref(), Some("invalid_target"));
    assert_eq!(
        f.begin(&client, &[("redirect_uri", Some("https://evil.example"))])
            .await
            .reply
            .status,
        400
    );

    let body = f.approve(&client, "read").await;
    let other_resource = format!("{ORIGIN}/mcp/{}", f.b.id);
    let verifier = "x".repeat(43);
    for change in [
        ("code_verifier", verifier.as_str()),
        ("client_id", other.as_str()),
        ("resource", other_resource.as_str()),
        ("redirect_uri", "https://evil.example"),
    ] {
        assert_eq!(f.token(&with(&body, &[change])).await.status, 400, "{change:?}");
    }
    let tokens = f.token(&body).await.body;
    assert!(tokens["access_token"].is_string());
    let refresh = pairs(&[
        ("grant_type", "refresh_token"),
        ("client_id", &client),
        ("refresh_token", &str_of(&tokens, "refresh_token")),
        ("resource", &f.resource),
    ]);
    for change in [
        ("scope", "whatsapp:read whatsapp:send"),
        ("resource", other_resource.as_str()),
        ("client_id", other.as_str()),
    ] {
        assert_eq!(f.token(&with(&refresh, &[change])).await.status, 400, "{change:?}");
    }
    assert_eq!(f.token(&refresh).await.status, 200);
}

#[tokio::test]
async fn consent_requires_local_proof_for_the_same_session_origin_and_unexpired_single_use_codes() {
    let f = Flow::new().await;
    let client = str_of(
        &f.register(json!({ "client_name": "<script>alert(1)</script>" }))
            .await
            .body,
        "client_id",
    );
    let flow = f.begin(&client, &[]).await;
    assert!(!flow.reply.text.contains("<script>"));
    assert!(flow.reply.text.contains("&lt;script&gt;"));
    let request = flow.request.unwrap_or_default();
    let wrong = str_of(&f.oauth().create_link(&f.b.id, "read_write").unwrap(), "code");
    assert_eq!(
        f.approve_form(&pairs(&[("request", &request), ("code", &wrong)]), ORIGIN)
            .await
            .status,
        400
    );
    let link = str_of(&f.oauth().create_link(&f.a.id, "read").unwrap(), "code");
    let form = pairs(&[("request", &request), ("code", &link)]);
    assert_eq!(f.approve_form(&form, "https://evil.example").await.status, 403);
    assert_eq!(f.approve_form(&form, ORIGIN).await.status, 303);
    assert_eq!(f.approve_form(&form, ORIGIN).await.status, 400);

    let another = f.begin(&client, &[]).await.request.unwrap_or_default();
    let expired = str_of(&f.oauth().create_link(&f.a.id, "read").unwrap(), "code");
    f.sql("UPDATE oauth_items SET expires=0 WHERE bucket='links'");
    assert_eq!(
        f.approve_form(&pairs(&[("request", &another), ("code", &expired)]), ORIGIN)
            .await
            .status,
        400
    );
    let path = format!("/api/sessions/{}/chatgpt/link", f.a.id);
    assert_eq!(
        f.f.public(common::http::request("POST", &path, None, &[])).await.status,
        404
    );
}
