//! `/token`, `/revoke` (client authentication + grants) and `/oauth/approve` (consent form).
use super::{cors, failure, fields, no_store, oauth_error, Fields};
use crate::adapters::inbound::http::rate_limit::{client_key, Peer};
use crate::adapters::inbound::http::state::AppState;
use crate::application::crypto::{base64url, same_secret};
use crate::application::oauth::OAuthService;
use axum::body::Bytes;
use axum::extract::State;
use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use regex::Regex;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::sync::LazyLock;

static OPAQUE: LazyLock<Regex> = LazyLock::new(|| Regex::new("^[A-Za-z0-9_-]{43}$").expect("valid regex"));

fn missing(field: &str) -> Response {
    let description = json!([{ "expected": "string", "code": "invalid_type", "path": [field], "message": "Invalid input: expected string, received undefined" }]);
    oauth_error("invalid_request", &serde_json::to_string_pretty(&description).unwrap_or_default())
}

/// Authenticates the client of a token or revocation request (public or `client_secret_post`).
fn client(oauth: &OAuthService, form: &Fields) -> Result<Value, Box<Response>> {
    let Some(id) = form.get("client_id") else {
        return Err(Box::new(missing("client_id")));
    };
    let client = oauth.get_client(id).ok_or_else(|| Box::new(oauth_error("invalid_client", "Invalid client_id")))?;
    if let Some(secret) = client["client_secret"].as_str() {
        let Some(given) = form.get("client_secret") else {
            return Err(Box::new(oauth_error("invalid_client", "Client secret is required")));
        };
        if !same_secret(given, secret) {
            return Err(Box::new(oauth_error("invalid_client", "Invalid client_secret")));
        }
    }
    Ok(client)
}

fn tokens(value: Value) -> Response {
    let mut response = Json(value).into_response();
    no_store(&mut response);
    response
}

pub async fn token(
    State(state): State<AppState>,
    peer: Peer,
    headers: HeaderMap,
    bytes: Bytes,
) -> Response {
    let Some(oauth) = state.oauth.as_ref() else {
        return StatusCode::NOT_FOUND.into_response();
    };
    if let Some(limited) = state.limits.token.reject(&client_key(&headers, peer.0)) {
        return cors(limited);
    }
    let form = fields(&headers, &bytes);
    let client = match client(oauth, &form) {
        Ok(client) => client,
        Err(response) => return cors(*response),
    };
    let client_id = client["client_id"].as_str().unwrap_or_default();
    let get = |k: &str| form.get(k).map(String::as_str);
    let response = match get("grant_type") {
        None => missing("grant_type"),
        Some("authorization_code") => {
            let (Some(code), Some(verifier)) = (get("code"), get("code_verifier")) else {
                return cors(missing(if get("code").is_none() { "code" } else { "code_verifier" }));
            };
            match oauth.challenge(client_id, code) {
                Err(error) => failure(error),
                Ok(challenge) if base64url(&Sha256::digest(verifier.as_bytes())) != challenge => {
                    oauth_error("invalid_grant", "code_verifier does not match the challenge")
                }
                Ok(_) => match oauth.exchange(&client, code, get("redirect_uri"), get("resource")) {
                    Ok(value) => tokens(value),
                    Err(error) => failure(error),
                },
            }
        }
        Some("refresh_token") => {
            let Some(refresh) = get("refresh_token") else {
                return cors(missing("refresh_token"));
            };
            let scopes = get("scope").map(|s| s.split(' ').filter(|p| !p.is_empty()).map(String::from).collect());
            match oauth.refresh(client_id, refresh, scopes, get("resource")) {
                Ok(value) => tokens(value),
                Err(error) => failure(error),
            }
        }
        Some(_) => oauth_error("unsupported_grant_type", "The grant type is not supported by this authorization server."),
    };
    cors(response)
}

pub async fn revoke(State(state): State<AppState>, headers: HeaderMap, bytes: Bytes) -> Response {
    let Some(oauth) = state.oauth.as_ref() else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let form = fields(&headers, &bytes);
    let client = match client(oauth, &form) {
        Ok(client) => client,
        Err(response) => return cors(*response),
    };
    let Some(token) = form.get("token") else {
        return cors(missing("token"));
    };
    let response = match oauth.revoke(client["client_id"].as_str().unwrap_or_default(), token) {
        Ok(()) => tokens(json!({})),
        Err(error) => failure(error),
    };
    cors(response)
}

fn page(status: StatusCode, text: &str) -> Response {
    let mut response = (status, axum::response::Html(text.to_string())).into_response();
    let headers = response.headers_mut();
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    headers.insert(header::REFERRER_POLICY, HeaderValue::from_static("no-referrer"));
    response
}

pub async fn approve(
    State(state): State<AppState>,
    peer: Peer,
    headers: HeaderMap,
    bytes: Bytes,
) -> Response {
    let Some(oauth) = state.oauth.as_ref() else {
        return StatusCode::NOT_FOUND.into_response();
    };
    if let Some(limited) = state.limits.approve.reject(&client_key(&headers, peer.0)) {
        return limited;
    }
    let origin = url::Url::parse(&state.public_url).map(|u| u.origin().ascii_serialization()).unwrap_or_default();
    if headers.get(header::ORIGIN).and_then(|v| v.to_str().ok()) != Some(origin.as_str()) {
        return page(StatusCode::FORBIDDEN, "Origem inválida. Reabra a conexão pelo ChatGPT.");
    }
    let form: Fields = url::form_urlencoded::parse(&bytes).into_owned().collect();
    let request = form.get("request").map(String::as_str).unwrap_or_default();
    let code = form.get("code").map(|c| c.trim()).unwrap_or_default();
    if bytes.len() > 4096 || !OPAQUE.is_match(request) || !OPAQUE.is_match(code) {
        return page(StatusCode::BAD_REQUEST, "Código inválido. Volte à página anterior e tente novamente.");
    }
    match oauth.approve(request, code) {
        Ok(location) => {
            let mut response = (StatusCode::SEE_OTHER, [(header::LOCATION, location)]).into_response();
            let headers = response.headers_mut();
            headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
            headers.insert(header::REFERRER_POLICY, HeaderValue::from_static("no-referrer"));
            response
        }
        Err(_) => page(
            StatusCode::BAD_REQUEST,
            "Código inválido, expirado ou de outra sessão. Volte e gere um novo código no aplicativo.",
        ),
    }
}
