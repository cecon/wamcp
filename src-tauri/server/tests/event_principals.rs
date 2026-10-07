//! Event subscription principals (port of tests/event-principals.test.mjs): session-scoped,
//! expiring and revocable tokens; OAuth grants that survive access rotation until disconnected.
mod common;

use common::{Fixture, ORIGIN};
use serde_json::json;
use wamcp_server::application::oauth::{AuthorizeParams, OAuthService};
use wamcp_server::application::ports::MirrorRepo;
use wamcp_server::domain::model::Credential;

const CALLBACK: &str = "https://chatgpt.com/connector/oauth/test-client";

#[tokio::test]
async fn event_token_principals_are_session_scoped_expiring_and_revocable() {
    let f = Fixture::new().await;
    let (a, b) = (f.session("Session A"), f.session("Session B"));
    let token = f.store.issue_token(&a.id, "Events", "read", 30).expect("token");
    let principal = f.store.event_principal(&a.id, &token.id).expect("query");
    let expected = Credential {
        id: token.id.clone(),
        session_id: a.id.clone(),
        scope: "read".into(),
        client_id: None,
    };
    assert_eq!(principal, Some(expected));
    assert_eq!(f.store.event_principal(&b.id, &token.id).expect("query"), None);
    let sql = "UPDATE tokens SET expires='2000-01-01' WHERE id=?";
    f.store
        .exec(sql, vec![rusqlite::types::Value::Text(token.id.clone())])
        .expect("expire");
    assert_eq!(f.store.event_principal(&a.id, &token.id).expect("query"), None);
    let next = f.store.issue_token(&a.id, "Events", "read", 30).expect("token");
    f.store.revoke(&a.id, &next.id).expect("revoke");
    assert_eq!(f.store.event_principal(&a.id, &next.id).expect("query"), None);
}

/// Registers a client, approves it with a desktop link code and exchanges the code for tokens.
fn authorize(oauth: &OAuthService, session: &str) -> (String, serde_json::Value) {
    let client = json!({
        "client_id": "client-events",
        "client_name": "ChatGPT test",
        "redirect_uris": [CALLBACK],
        "token_endpoint_auth_method": "none",
    });
    let client = oauth.register_client(client).expect("client");
    let link = oauth.create_link(session, "read").expect("link");
    let params = AuthorizeParams {
        resource: Some(oauth.resource_for(session)),
        scopes: vec![],
        code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM".into(),
        redirect_uri: CALLBACK.into(),
        state: None,
    };
    let (request, _) = oauth.begin(&client, params).expect("begin");
    let redirect = oauth
        .approve(&request, link["code"].as_str().expect("code"))
        .expect("approve");
    let redirect = url::Url::parse(&redirect).expect("redirect");
    let code = redirect
        .query_pairs()
        .find(|(k, _)| k == "code")
        .map(|(_, v)| v.into_owned())
        .expect("code");
    let resource = oauth.resource_for(session);
    let tokens = oauth
        .exchange(&client, &code, Some(CALLBACK), Some(&resource))
        .expect("tokens");
    ("client-events".into(), tokens)
}

#[tokio::test]
async fn event_oauth_principal_survives_access_rotation_but_stops_after_grant_revocation() {
    let f = Fixture::new().await;
    let (a, b) = (f.session("Session A"), f.session("Session B"));
    let oauth = f.app.state.oauth.clone().expect("oauth");
    assert_eq!(oauth.resource_for(&a.id), format!("{ORIGIN}/mcp/{}", a.id));
    let (client_id, tokens) = authorize(&oauth, &a.id);
    let access = tokens["access_token"].as_str().expect("access");
    let principal = oauth.authenticate(&a.id, access).expect("authenticated");
    assert!(oauth.event_principal(&a.id, &principal.id).is_some());
    assert!(oauth.event_principal(&b.id, &principal.id).is_none());
    f.store
        .exec("UPDATE oauth_items SET expires=0 WHERE bucket='access'", vec![])
        .expect("expire");
    assert!(oauth.authenticate(&a.id, access).is_none());
    assert!(oauth.event_principal(&a.id, &principal.id).is_some());
    let resource = oauth.resource_for(&a.id);
    let refresh = tokens["refresh_token"].as_str().expect("refresh");
    let next = oauth
        .refresh(&client_id, refresh, None, Some(&resource))
        .expect("rotated");
    let rotated = oauth
        .authenticate(&a.id, next["access_token"].as_str().expect("access"))
        .expect("authenticated");
    assert_eq!(rotated.id, principal.id);
    oauth.disconnect(&a.id, &principal.id).expect("disconnect");
    assert!(oauth.event_principal(&a.id, &principal.id).is_none());
}
