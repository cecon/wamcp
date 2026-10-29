//! The GitHub channel: connecting a repository (administrators) and the public webhook GitHub
//! posts its events to (authenticated by the `X-Hub-Signature-256` HMAC, not by a session).
use super::auth::CurrentUser;
use super::error::{created, ok, ApiResult};
use super::input::{id, Body};
use super::state::AppState;
use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::Router;
use serde::Deserialize;

#[derive(Deserialize)]
struct Connect {
    name: String,
    repo: String,
    token: String,
}

async fn connect(
    State(state): State<AppState>,
    current: CurrentUser,
    Body(body): Body<Connect>,
) -> ApiResult<Response> {
    let connection = state
        .support()
        .helpdesk
        .connect_github(&current.actor(), &body.name, &body.repo, &body.token, &state.public_url)
        .await?;
    created(connection)
}

async fn setup(State(state): State<AppState>, current: CurrentUser, Path(inbox): Path<String>) -> ApiResult<Response> {
    let setup = state
        .support()
        .helpdesk
        .github_setup(&current.actor(), id(&inbox)?, &state.public_url)?;
    ok(setup)
}

fn header<'a>(headers: &'a HeaderMap, name: &str) -> &'a str {
    headers.get(name).and_then(|v| v.to_str().ok()).unwrap_or_default()
}

async fn webhook(
    State(state): State<AppState>,
    Path(inbox): Path<String>,
    headers: HeaderMap,
    body: Bytes,
) -> ApiResult<Response> {
    let event = header(&headers, "x-github-event");
    if event == "ping" {
        return Ok(StatusCode::NO_CONTENT.into_response());
    }
    state.support().helpdesk.receive_github(
        id(&inbox)?,
        event,
        header(&headers, "x-github-delivery"),
        header(&headers, "x-hub-signature-256"),
        &body,
    )?;
    Ok(StatusCode::ACCEPTED.into_response())
}

/// Under `/api/v1` (session and same-origin checks).
pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/github_channels", post(connect))
        .route("/inboxes/{id}/github", get(setup))
}

/// Mounted outside `/api/v1`: GitHub calls it from its servers.
pub fn webhook_routes() -> Router<AppState> {
    Router::new().route("/api/github/{id}/webhook", post(webhook))
}
