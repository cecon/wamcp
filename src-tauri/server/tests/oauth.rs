//! OAuth for ChatGPT: discovery, DCR, PKCE, consent, session-bound tokens, scopes and revocation
//! (port of `tests/oauth.test.mjs`).
mod common;
mod oauth_flow;

use oauth_flow::{pairs, str_of, with, Flow};
use serde_json::{json, Value};
use wamcp_server::application::ports::{MirrorRepo, OAuthRepo};

fn tool<'a>(listed: &'a Value, name: &str) -> &'a Value {
    let tools = listed["result"]["tools"].as_array().expect("tools");
    tools.iter().find(|t| t["name"] == name).unwrap_or(&Value::Null)
}

#[tokio::test]
async fn read_only_oauth_discovers_send_requests_consent_and_sends_only_after_reauthorization() {
    let f = Flow::new().await;
    let client = str_of(&f.register(json!({})).await.body, "client_id");
    let reader = f.token(&f.approve(&client, "read").await).await.body;
    let before = f.rpc(&str_of(&reader, "access_token"), "tools/list").await.body;
    assert!(!tool(&before, "send_message").is_null());
    let args = json!({ "jid": "5511999999999@s.whatsapp.net", "text": "Oi" });
    let call = |token: String| {
        let (f, args) = (&f, args.clone());
        async move { f.rpc_with(&token, "send_message", &f.a, args).await.body["result"].clone() }
    };
    let denied = call(str_of(&reader, "access_token")).await;
    assert_eq!(denied["isError"], true);
    let challenge = denied["_meta"]["mcp/www_authenticate"][0].as_str().unwrap_or_default();
    assert!(challenge.contains("error=\"insufficient_scope\""), "{challenge}");
    assert!(
        challenge.contains("scope=\"whatsapp:read whatsapp:send\""),
        "{challenge}"
    );
    assert_eq!(f.f.wa.sent().len(), 0);

    let writer = f.token(&f.approve(&client, "read_write").await).await.body;
    let after = f.rpc(&str_of(&writer, "access_token"), "tools/list").await.body;
    assert_eq!(after["result"]["tools"], before["result"]["tools"]);
    let result = call(str_of(&writer, "access_token")).await;
    assert!(result.get("isError").is_none(), "{result}");
    let text = result["content"][0]["text"].as_str().unwrap_or_default();
    let sent_id: Value = serde_json::from_str(text).expect("json text");
    assert_eq!(
        sent_id,
        json!({ "id": "OUT1" }),
        "the in-memory port names sends OUT<n>"
    );
    let sent = f.f.wa.sent();
    assert_eq!(sent.len(), 1);
    assert_eq!(
        (sent[0].session_id.as_str(), sent[0].jid.as_str(), sent[0].text.as_str()),
        (f.a.id.as_str(), "5511999999999@s.whatsapp.net", "Oi")
    );
    assert_eq!(f.f.store.audit_events(&f.a.id).unwrap()[0].action, "send_message");
    assert_eq!(call(str_of(&reader, "access_token")).await["isError"], true);
    assert_eq!(f.f.wa.sent().len(), 1);
    f.form(
        "/revoke",
        &pairs(&[("client_id", &client), ("token", &str_of(&writer, "refresh_token"))]),
        &[],
    )
    .await;
    let revoked = f
        .rpc_with(&str_of(&writer, "access_token"), "send_message", &f.a, args.clone())
        .await;
    assert_eq!(revoked.status, 401);
    assert_eq!(f.f.wa.sent().len(), 1);
}

#[tokio::test]
async fn discovery_dcr_pkce_session_bound_tokens_profile_and_revocation() {
    let f = Flow::new().await;
    let protected =
        f.f.public(common::http::request("POST", &format!("/mcp/{}", f.a.id), None, &[]))
            .await;
    assert_eq!(protected.status, 401);
    let challenge = protected.header("www-authenticate").unwrap_or_default();
    assert!(
        challenge.contains(&format!("oauth-protected-resource/mcp/{}", f.a.id)),
        "{challenge}"
    );
    let metadata = f
        .get(&format!("/.well-known/oauth-protected-resource/mcp/{}", f.a.id), &[])
        .await
        .body;
    assert_eq!(metadata["resource"], f.resource.as_str());
    let auth = f.get("/.well-known/oauth-authorization-server", &[]).await.body;
    assert_eq!(auth["issuer"], metadata["authorization_servers"][0]);
    assert_eq!(auth["code_challenge_methods_supported"], json!(["S256"]));

    let registered = f.register(json!({})).await;
    assert_eq!(registered.status, 201);
    let client = str_of(&registered.body, "client_id");
    let body = f.approve(&client, "read").await;
    let response = f.token(&body).await;
    assert_eq!(response.status, 200);
    let tokens = response.body;
    assert_eq!(tokens["scope"], "whatsapp:read");
    assert_eq!(tokens["expires_in"], 3600);
    let access = str_of(&tokens, "access_token");
    let result = f.rpc(&access, "get_profile").await.body;
    assert_eq!(
        result["result"]["structuredContent"],
        json!({ "id": f.a.id, "name": "Session A" })
    );

    let listed = f.rpc(&access, "tools/list").await.body;
    let send = tool(&listed, "send_message");
    assert_eq!(
        send["securitySchemes"],
        json!([{ "type": "oauth2", "scopes": ["whatsapp:read", "whatsapp:send"] }])
    );
    assert_eq!(send["annotations"]["readOnlyHint"], false);
    let profile = tool(&listed, "get_profile");
    assert_eq!(profile["_meta"]["openai/profile"], true);
    assert_eq!(profile["securitySchemes"][0]["type"], "oauth2");
    assert_eq!(f.rpc_with(&access, "get_profile", &f.b, json!({})).await.status, 401);
    assert_eq!(f.token(&body).await.status, 400);

    let persisted = OAuthRepo::get(&*f.f.store, "clients", &client, f.f.clock.now_secs() * 1000).unwrap();
    assert_eq!(persisted.unwrap()["client_id"], client.as_str());
    let sql = "SELECT key,value FROM oauth_items WHERE bucket IN ('access','refresh','codes','links')";
    let stored: Vec<String> =
        f.f.store
            .with(|c| {
                let mut statement = c.prepare(sql)?;
                let row = |r: &rusqlite::Row| Ok(format!("{}{}", r.get::<_, String>(0)?, r.get::<_, String>(1)?));
                let rows = statement.query_map([], row)?;
                rows.collect()
            })
            .unwrap();
    let joined = stored.join("|");
    assert!(!stored.is_empty());
    assert!(!joined.contains(&access));
    assert!(!joined.contains(&str_of(&tokens, "refresh_token")));

    let refresh = pairs(&[
        ("client_id", &client),
        ("grant_type", "refresh_token"),
        ("refresh_token", &str_of(&tokens, "refresh_token")),
        ("resource", &f.resource),
    ]);
    let refreshed = f.token(&refresh).await;
    assert_eq!(refreshed.status, 200);
    let next = refreshed.body;
    assert_ne!(next["refresh_token"], tokens["refresh_token"]);
    let again = f.rpc(&str_of(&next, "access_token"), "get_profile").await.body;
    assert_eq!(
        again["result"]["structuredContent"],
        result["result"]["structuredContent"]
    );
    let revoke = pairs(&[("client_id", &client), ("token", &str_of(&next, "refresh_token"))]);
    assert_eq!(f.form("/revoke", &revoke, &[]).await.status, 200);
    assert_eq!(f.rpc(&access, "get_profile").await.status, 401);
    assert_eq!(f.rpc(&str_of(&next, "access_token"), "get_profile").await.status, 401);
}

#[tokio::test]
async fn confidential_clients_persist_without_secret_expiry_and_desktop_revocation_invalidates_refresh() {
    let f = Flow::new().await;
    let registered = f
        .register(json!({ "token_endpoint_auth_method": "client_secret_post" }))
        .await
        .body;
    assert_eq!(registered["client_secret_expires_at"], 0);
    let (client, secret) = (str_of(&registered, "client_id"), str_of(&registered, "client_secret"));
    let body = f.approve(&client, "read_write").await;
    let missing_secret = f.token(&body).await;
    assert_eq!(missing_secret.status, 400);
    assert_eq!(missing_secret.body["error"], "invalid_client");
    let response = f.token(&with(&body, &[("client_secret", &secret)])).await;
    assert_eq!(response.status, 200);
    let tokens = response.body;
    assert_eq!(tokens["scope"], "whatsapp:read whatsapp:send");
    let access = str_of(&tokens, "access_token");
    assert!(!tool(&f.rpc(&access, "tools/list").await.body, "send_message").is_null());

    let grants = f.oauth().connections(&f.a.id);
    assert_eq!(grants.len(), 1);
    let grant = str_of(&grants[0], "id");
    f.oauth().disconnect(&f.b.id, &grant).unwrap();
    assert!(f.oauth().authenticate(&f.a.id, &access).is_some());
    f.oauth().disconnect(&f.a.id, &grant).unwrap();
    assert!(f.oauth().authenticate(&f.a.id, &access).is_none());
    let refresh = pairs(&[
        ("client_id", &client),
        ("client_secret", &secret),
        ("grant_type", "refresh_token"),
        ("refresh_token", &str_of(&tokens, "refresh_token")),
        ("resource", &f.resource),
    ]);
    assert_eq!(f.token(&refresh).await.status, 400);
}
