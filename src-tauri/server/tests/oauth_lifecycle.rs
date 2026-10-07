//! OAuth lifecycle: refresh rotation with reuse detection, persistence across reopen, code expiry
//! and the tool-level authentication challenge (port of `tests/oauth-lifecycle.test.mjs`).
mod common;
mod oauth_flow;

use common::ORIGIN;
use oauth_flow::{pairs, str_of, with, Flow, CALLBACK};
use serde_json::{json, Map};
use std::sync::Arc;
use wamcp_server::adapters::inbound::mcp::catalog::tools;
use wamcp_server::adapters::inbound::mcp::tools::Call;
use wamcp_server::adapters::outbound::clock::ManualClock;
use wamcp_server::adapters::outbound::sqlite::SqliteStore;
use wamcp_server::application::oauth::{AuthorizeParams, OAuthService};
use wamcp_server::application::ports::MirrorRepo;

#[tokio::test]
async fn refresh_reuse_revokes_the_token_family_and_access_expiry_requires_refresh() {
    let f = Flow::new().await;
    let client = str_of(&f.register(json!({})).await.body, "client_id");
    let tokens = f.token(&f.approve(&client, "read").await).await.body;
    f.sql("UPDATE oauth_items SET expires=0 WHERE bucket='access'");
    assert_eq!(f.rpc(&str_of(&tokens, "access_token"), "get_profile").await.status, 401);
    let body = pairs(&[
        ("client_id", &client),
        ("grant_type", "refresh_token"),
        ("refresh_token", &str_of(&tokens, "refresh_token")),
        ("resource", &f.resource),
    ]);
    let rotated = f.token(&body).await;
    assert_eq!(rotated.status, 200);
    let next = rotated.body;
    assert_eq!(f.rpc(&str_of(&next, "access_token"), "get_profile").await.status, 200);
    assert_eq!(f.token(&body).await.status, 400);
    assert_eq!(f.rpc(&str_of(&next, "access_token"), "get_profile").await.status, 401);
    let next_refresh = str_of(&next, "refresh_token");
    assert_eq!(
        f.token(&with(&body, &[("refresh_token", &next_refresh)])).await.status,
        400
    );
}

fn service(store: &Arc<SqliteStore>) -> OAuthService {
    let clock = Arc::new(ManualClock::at(common::START * 1000));
    OAuthService {
        repo: store.clone(),
        clock,
        public_url: ORIGIN.into(),
    }
}

fn expire(store: &SqliteStore, bucket: &str) {
    let sql = format!("UPDATE oauth_items SET expires=0 WHERE bucket='{bucket}'");
    store.with(|c| c.execute(&sql, [])).expect("sql");
}

#[test]
fn clients_and_grants_survive_sqlite_reopen_and_authorization_codes_expire() {
    let dir = tempfile::tempdir().expect("temp dir");
    let mut store = Arc::new(SqliteStore::open(dir.path()).expect("store"));
    let mut oauth = service(&store);
    let session = store.create_session("Persistent").unwrap();
    let client = oauth
        .register_client(json!({
            "client_id": "client",
            "client_name": "ChatGPT",
            "redirect_uris": [CALLBACK],
            "token_endpoint_auth_method": "none",
        }))
        .unwrap();
    let resource = format!("{ORIGIN}/mcp/{}", session.id);
    let authorize = |oauth: &OAuthService| {
        let params = AuthorizeParams {
            resource: Some(resource.clone()),
            scopes: vec!["whatsapp:read".into()],
            code_challenge: "x".repeat(43),
            redirect_uri: CALLBACK.into(),
            state: None,
        };
        let (request, _) = oauth.begin(&client, params).unwrap();
        let link = str_of(&oauth.create_link(&session.id, "read").unwrap(), "code");
        let location = oauth.approve(&request, &link).unwrap();
        oauth_flow::query_param(&location, "code").unwrap()
    };
    let expired = authorize(&oauth);
    expire(&store, "codes");
    assert!(oauth
        .exchange(&client, &expired, Some(CALLBACK), Some(&resource))
        .is_err());
    let tokens = oauth
        .exchange(&client, &authorize(&oauth), Some(CALLBACK), Some(&resource))
        .unwrap();

    drop(oauth);
    drop(store);
    store = Arc::new(SqliteStore::open(dir.path()).expect("reopen"));
    oauth = service(&store);
    assert_eq!(oauth.get_client("client").unwrap()["client_name"], "ChatGPT");
    let access = str_of(&tokens, "access_token");
    assert_eq!(oauth.authenticate(&session.id, &access).unwrap().session_id, session.id);
    let refreshed = oauth
        .refresh("client", &str_of(&tokens, "refresh_token"), None, Some(&resource))
        .unwrap();
    assert!(refreshed["access_token"].is_string());
    expire(&store, "grants");
    assert!(oauth.authenticate(&session.id, &access).is_none());
}

#[tokio::test]
async fn a_revoked_credential_produces_the_chatgpt_tool_level_authentication_challenge() {
    let f = Flow::new().await;
    let issued = f.f.store.issue_token(&f.a.id, "Reader", "read", 90).unwrap();
    let state = &f.f.app.state;
    assert!(state.mcp.authenticate(&f.a.id, &issued.token).is_some());
    f.f.store.revoke(&f.a.id, &issued.id).unwrap();
    let call = Call {
        state,
        session_id: &f.a.id,
        credential: &issued.token,
    };
    let catalog = tools();
    let profile = catalog.iter().find(|t| t.name == "get_profile").expect("get_profile");
    let result = call.run(profile, &Map::new()).await;
    assert_eq!(result["isError"], true);
    let challenge = result["_meta"]["mcp/www_authenticate"][0].as_str().unwrap_or_default();
    assert!(challenge.contains("resource_metadata="), "{challenge}");
    assert!(result.get("structuredContent").is_none());
}
