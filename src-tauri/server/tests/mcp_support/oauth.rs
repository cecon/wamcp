//! OAuth grants issued through the service for MCP tests.
use crate::common::Fixture;
use serde_json::json;
use wamcp_server::application::oauth::AuthorizeParams;

/// Runs the OAuth consent flow through the service and returns (access token, grant id).
pub fn oauth_grant(f: &Fixture, session_id: &str, scope: &str) -> (String, String) {
    let oauth = f.app.state.oauth.clone().expect("oauth service");
    let redirect = "https://chatgpt.com/connector_platform_oauth_redirect";
    let client = json!({ "client_id": "client-id", "client_name": "Client", "redirect_uris": [redirect],
        "token_endpoint_auth_method": "none" });
    let client = oauth.register_client(client).expect("client");
    let link = oauth.create_link(session_id, scope).expect("link")["code"]
        .as_str()
        .unwrap_or_default()
        .to_string();
    let resource = oauth.resource_for(session_id);
    let params = AuthorizeParams {
        resource: Some(resource.clone()),
        scopes: vec!["whatsapp:read".into()],
        code_challenge: "a".repeat(43),
        redirect_uri: redirect.into(),
        state: None,
    };
    let (pending, _) = oauth.begin(&client, params).expect("begin");
    let location = oauth.approve(&pending, &link).expect("approve");
    let url = url::Url::parse(&location).expect("redirect");
    let code = url
        .query_pairs()
        .find(|(k, _)| k == "code")
        .map(|(_, v)| v.into_owned())
        .unwrap_or_default();
    let issued = oauth
        .exchange(&client, &code, Some(redirect), Some(&resource))
        .expect("exchange");
    let token = issued["access_token"].as_str().unwrap_or_default().to_string();
    let grant = oauth.authenticate(session_id, &token).expect("oauth credential").id;
    (token, grant)
}
