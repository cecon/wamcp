//! OAuth 2.1 authorization server endpoints for MCP clients (metadata, dynamic registration,
//! authorization with PKCE, token, revocation) — the behavior of the MCP SDK's auth router.
mod consent;
mod token;

use super::http::input::{is_json, BODY_LIMIT};
use super::http::state::AppState;
use crate::application::oauth::AuthorizeParams;
use crate::domain::oauth::{OAuthFailure, OAUTH_SCOPES};
use axum::body::Bytes;
use axum::extract::{Path, Query, State};
use axum::http::{header, HeaderMap, HeaderValue, Method, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde_json::{json, Map, Value};
use std::collections::HashMap;

pub type Fields = HashMap<String, String>;

pub fn issuer(state: &AppState) -> String {
    format!("{}/", state.public_url.trim_end_matches('/'))
}

/// `{ error, error_description }` with `Cache-Control: no-store` (500 for server errors).
pub fn oauth_error(code: &str, description: &str) -> Response {
    let status = if code == "server_error" { StatusCode::INTERNAL_SERVER_ERROR } else { StatusCode::BAD_REQUEST };
    let mut response = (status, Json(json!({ "error": code, "error_description": description }))).into_response();
    no_store(&mut response);
    response
}

pub fn failure(error: OAuthFailure) -> Response {
    oauth_error(&error.code, &error.message)
}

pub fn no_store(response: &mut Response) {
    response.headers_mut().insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
}

pub fn cors(mut response: Response) -> Response {
    response.headers_mut().insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, HeaderValue::from_static("*"));
    response
}

/// Form (or JSON) body fields as strings.
pub fn fields(headers: &HeaderMap, bytes: &Bytes) -> Fields {
    let content_type = headers.get(header::CONTENT_TYPE).and_then(|v| v.to_str().ok());
    if bytes.len() > BODY_LIMIT {
        return Fields::new();
    }
    if is_json(content_type) {
        let object: Map<String, Value> = serde_json::from_slice(bytes).unwrap_or_default();
        return object.into_iter().filter_map(|(k, v)| v.as_str().map(|s| (k, s.to_string()))).collect();
    }
    url::form_urlencoded::parse(bytes).into_owned().collect()
}

async fn metadata(State(state): State<AppState>) -> Response {
    let issuer = issuer(&state);
    let base = state.public_url.trim_end_matches('/');
    cors(Json(json!({
        "issuer": issuer,
        "authorization_endpoint": format!("{base}/authorize"),
        "response_types_supported": ["code"],
        "code_challenge_methods_supported": ["S256"],
        "token_endpoint": format!("{base}/token"),
        "token_endpoint_auth_methods_supported": ["client_secret_post", "none"],
        "grant_types_supported": ["authorization_code", "refresh_token"],
        "scopes_supported": OAUTH_SCOPES,
        "revocation_endpoint": format!("{base}/revoke"),
        "revocation_endpoint_auth_methods_supported": ["client_secret_post"],
        "registration_endpoint": format!("{base}/register"),
    })).into_response())
}

async fn protected_resource(State(state): State<AppState>, Path(id): Path<String>) -> Response {
    if uuid::Uuid::parse_str(&id).is_err() || id.len() != 36 {
        return (StatusCode::NOT_FOUND, "Not Found").into_response();
    }
    cors(Json(json!({
        "resource": format!("{}/mcp/{id}", state.public_url),
        "authorization_servers": [issuer(&state)],
        "scopes_supported": OAUTH_SCOPES,
        "resource_name": "WA MCP",
    })).into_response())
}

async fn register(State(state): State<AppState>, bytes: Bytes) -> Response {
    let Some(oauth) = state.oauth.as_ref() else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let Ok(Value::Object(mut client)) = serde_json::from_slice::<Value>(&bytes) else {
        return super::http::error::error_body(StatusCode::BAD_REQUEST, "Dados inválidos");
    };
    if !client.get("redirect_uris").is_some_and(Value::is_array) {
        return cors(oauth_error("invalid_client_metadata", "redirect_uris: Invalid input: expected array, received undefined"));
    }
    let public = client.get("token_endpoint_auth_method").and_then(Value::as_str) == Some("none");
    if !public {
        client.insert("client_secret".into(), json!(hex::encode(crate::application::crypto::random_bytes(32))));
        client.insert("client_secret_expires_at".into(), json!(0));
    }
    client.insert("client_id".into(), json!(uuid::Uuid::new_v4().to_string()));
    client.insert("client_id_issued_at".into(), json!(chrono::Utc::now().timestamp()));
    match oauth.register_client(Value::Object(client)) {
        Ok(registered) => {
            let mut response = (StatusCode::CREATED, Json(registered)).into_response();
            no_store(&mut response);
            cors(response)
        }
        Err(error) => cors(failure(error)),
    }
}

fn redirect_error(redirect: &str, code: &str, description: &str, state: Option<&str>) -> Response {
    let mut url = match url::Url::parse(redirect) {
        Ok(url) => url,
        Err(_) => return oauth_error(code, description),
    };
    url.query_pairs_mut().append_pair("error", code).append_pair("error_description", description);
    if let Some(state) = state {
        url.query_pairs_mut().append_pair("state", state);
    }
    let mut response = (StatusCode::FOUND, [(header::LOCATION, url.to_string())]).into_response();
    no_store(&mut response);
    response
}

async fn authorize(State(state): State<AppState>, method: Method, Query(query): Query<Fields>, headers: HeaderMap, bytes: Bytes) -> Response {
    let Some(oauth) = state.oauth.as_ref() else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let params = if method == Method::POST { fields(&headers, &bytes) } else { query };
    let get = |k: &str| params.get(k).map(String::as_str);
    let Some(client) = get("client_id").and_then(|id| oauth.get_client(id)) else {
        return oauth_error("invalid_client", "Invalid client_id");
    };
    let registered: Vec<String> = client["redirect_uris"].as_array().map(|u| u.iter().filter_map(|v| v.as_str().map(String::from)).collect()).unwrap_or_default();
    let redirect = match get("redirect_uri") {
        Some(uri) if registered.iter().any(|r| r == uri) => uri.to_string(),
        Some(_) => return oauth_error("invalid_request", "Unregistered redirect_uri"),
        None if registered.len() == 1 => registered[0].clone(),
        None => return oauth_error("invalid_request", "redirect_uri must be specified when client has multiple registered URIs"),
    };
    let invalid = |field: &str, expected: &str| {
        let description = json!([{ "code": "invalid_value", "values": [expected], "path": [field], "message": format!("Invalid input: expected \"{expected}\"") }]);
        redirect_error(&redirect, "invalid_request", &serde_json::to_string_pretty(&description).unwrap_or_default(), None)
    };
    if get("response_type") != Some("code") {
        return invalid("response_type", "code");
    }
    if get("code_challenge_method") != Some("S256") || get("code_challenge").is_none() {
        return invalid("code_challenge_method", "S256");
    }
    let state_param = get("state").map(String::from);
    let request = AuthorizeParams {
        resource: get("resource").map(|r| url::Url::parse(r).map(|u| u.to_string()).unwrap_or_else(|_| r.to_string())),
        scopes: get("scope").map(|s| s.split(' ').filter(|p| !p.is_empty()).map(String::from).collect()).unwrap_or_default(),
        code_challenge: get("code_challenge").unwrap_or_default().to_string(),
        redirect_uri: redirect.clone(),
        state: state_param.clone(),
    };
    match oauth.begin(&client, request) {
        Ok((request, pending)) => consent::consent_page(&request, &pending),
        Err(error) => redirect_error(&redirect, &error.code, &error.message, state_param.as_deref()),
    }
}

/// CORS preflight for the endpoints browsers may call cross-origin.
async fn preflight() -> Response {
    let mut response = StatusCode::NO_CONTENT.into_response();
    let headers = response.headers_mut();
    headers.insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, HeaderValue::from_static("*"));
    headers.insert(header::ACCESS_CONTROL_ALLOW_METHODS, HeaderValue::from_static("GET,POST,OPTIONS"));
    headers.insert(header::ACCESS_CONTROL_ALLOW_HEADERS, HeaderValue::from_static("Content-Type,Authorization"));
    response
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/.well-known/oauth-authorization-server", get(metadata).options(preflight))
        .route("/.well-known/oauth-protected-resource/mcp/{id}", get(protected_resource).options(preflight))
        .route("/register", post(register).options(preflight))
        .route("/authorize", get(authorize).post(authorize))
        .route("/token", post(token::token).options(preflight))
        .route("/revoke", post(token::revoke).options(preflight))
        .route("/oauth/approve", post(token::approve))
}
