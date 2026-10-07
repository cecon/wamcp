//! Authentication of the helpdesk API (session cookie + CSRF, or `api_access_token`), the same-origin
//! guard of `/api/v1` and the desktop admin token guard of the local admin listener.
use super::error::{error_body, ApiError};
use super::state::AppState;
use crate::application::crypto::same_secret;
use crate::domain::actor::Actor;
use crate::domain::model::User;
use axum::extract::{FromRequestParts, Request, State};
use axum::http::request::Parts;
use axum::http::{header, HeaderMap, HeaderValue, Method, StatusCode};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};

pub const SESSION_COOKIE: &str = "wamcp_session";
const ADMIN_ORIGINS: [&str; 5] = [
    "http://127.0.0.1:1420",
    "http://localhost:1420",
    "http://tauri.localhost",
    "https://tauri.localhost",
    "tauri://localhost",
];

pub fn read_cookie(headers: &HeaderMap, name: &str) -> Option<String> {
    let cookies = headers.get(header::COOKIE)?.to_str().ok()?;
    cookies.split(';').find_map(|part| {
        let (key, value) = part.trim().split_once('=')?;
        (key == name).then(|| url::form_urlencoded::parse(format!("v={value}").as_bytes()).next().map(|(_, v)| v.into_owned()))?
    })
}

pub fn session_cookie(value: &str, max_age_ms: i64) -> HeaderValue {
    let age = (max_age_ms / 1000).max(0);
    let encoded: String = url::form_urlencoded::byte_serialize(value.as_bytes()).collect();
    let cookie = format!("{SESSION_COOKIE}={encoded}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age={age}");
    HeaderValue::from_str(&cookie).unwrap_or(HeaderValue::from_static(""))
}

pub fn bearer(headers: &HeaderMap) -> Option<String> {
    let value = headers.get(header::AUTHORIZATION)?.to_str().ok()?;
    let (scheme, token) = value.split_once(' ')?;
    (scheme.eq_ignore_ascii_case("bearer") && !token.is_empty() && !token.contains(char::is_whitespace))
        .then(|| token.to_string())
}

/// The authenticated agent of a helpdesk request (and its CSRF token for cookie sessions).
pub struct CurrentUser {
    pub user: User,
    pub csrf: Option<String>,
}

impl CurrentUser {
    pub fn actor(&self) -> Actor {
        Actor::User(self.user.clone())
    }
}

impl FromRequestParts<AppState> for CurrentUser {
    type Rejection = Response;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, Response> {
        let accounts = &state.support().accounts;
        let unauthorized = |message| error_body(StatusCode::UNAUTHORIZED, message);
        if let Some(token) = parts.headers.get("api_access_token").and_then(|v| v.to_str().ok()) {
            let user = accounts.authenticate_api_token(token).map_err(|e| ApiError::from(e).into_response())?;
            return user.map(|user| Self { user, csrf: None }).ok_or_else(|| unauthorized("Token inválido"));
        }
        let cookie = read_cookie(&parts.headers, SESSION_COOKIE);
        let session = match cookie {
            Some(cookie) => accounts.authenticate_cookie(&cookie).map_err(|e| ApiError::from(e).into_response())?,
            None => None,
        };
        let Some((user, csrf)) = session else {
            return Err(unauthorized("Faça login para continuar"));
        };
        let safe = matches!(parts.method, Method::GET | Method::HEAD | Method::OPTIONS);
        let sent = parts.headers.get("x-csrf-token").and_then(|v| v.to_str().ok()).unwrap_or_default();
        if !safe && !same_secret(sent, &csrf) {
            return Err(error_body(StatusCode::FORBIDDEN, "Token CSRF inválido"));
        }
        Ok(Self { user, csrf: Some(csrf) })
    }
}

/// Only same-origin browser requests (or the public URL) may reach the helpdesk API.
pub async fn same_origin(State(state): State<AppState>, request: Request, next: Next) -> Response {
    if let Some(origin) = request.headers().get(header::ORIGIN).and_then(|v| v.to_str().ok()) {
        let host = request.headers().get(header::HOST).and_then(|v| v.to_str().ok()).unwrap_or_default();
        if origin != state.public_url && origin != format!("http://{host}") {
            return error_body(StatusCode::FORBIDDEN, "Origem não permitida");
        }
    }
    next.run(request).await
}

/// The local admin listener only answers the desktop app (allowed origins + admin bearer token).
pub async fn admin_guard(State(state): State<AppState>, request: Request, next: Next) -> Response {
    let origin = request.headers().get(header::ORIGIN).and_then(|v| v.to_str().ok()).map(str::to_string);
    if let Some(origin) = &origin {
        if !ADMIN_ORIGINS.contains(&origin.as_str()) {
            return StatusCode::FORBIDDEN.into_response();
        }
    }
    let mut response = if request.method() == Method::OPTIONS {
        StatusCode::NO_CONTENT.into_response()
    } else if !same_secret(&bearer(request.headers()).unwrap_or_default(), &state.admin_token) {
        StatusCode::UNAUTHORIZED.into_response()
    } else {
        next.run(request).await
    };
    if let Some(origin) = origin.and_then(|o| HeaderValue::from_str(&o).ok()) {
        let headers = response.headers_mut();
        headers.insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, origin);
        headers.insert(header::VARY, HeaderValue::from_static("Origin"));
        headers.insert(header::ACCESS_CONTROL_ALLOW_HEADERS, HeaderValue::from_static("Authorization,Content-Type"));
        headers.insert(header::ACCESS_CONTROL_ALLOW_METHODS, HeaderValue::from_static("GET,POST,DELETE,OPTIONS"));
    }
    response
}
