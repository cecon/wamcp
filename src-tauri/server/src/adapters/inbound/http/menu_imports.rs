//! iFood imports (`/catalog/imports`, administrators): start, follow, apply and cancel.
use super::auth::CurrentUser;
use super::error::{created, ok, ApiResult};
use super::input::{text, Body};
use super::state::AppState;
use axum::extract::{Path, State};
use axum::response::Response;
use axum::routing::{get, post};
use axum::Router;
use serde::Deserialize;

#[derive(Deserialize)]
struct Start {
    url: String,
}

async fn start(State(state): State<AppState>, current: CurrentUser, Body(body): Body<Start>) -> ApiResult<Response> {
    let url = text(&body.url, 1, 500)?;
    created(state.support().menu.start_import(&current.actor(), &url)?)
}

async fn show(State(state): State<AppState>, current: CurrentUser, Path(import): Path<String>) -> ApiResult<Response> {
    ok(state.support().menu.import(&current.actor(), &text(&import, 1, 64)?)?)
}

#[derive(Deserialize)]
struct Apply {
    mode: String,
}

async fn apply(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(import): Path<String>,
    Body(body): Body<Apply>,
) -> ApiResult<Response> {
    let id = text(&import, 1, 64)?;
    ok(state
        .support()
        .menu
        .apply_import(&current.actor(), &id, &body.mode)
        .await?)
}

async fn cancel(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(import): Path<String>,
) -> ApiResult<Response> {
    ok(state
        .support()
        .menu
        .cancel_import(&current.actor(), &text(&import, 1, 64)?)?)
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/catalog/imports", post(start))
        .route("/catalog/imports/{id}", get(show).delete(cancel))
        .route("/catalog/imports/{id}/apply", post(apply))
}
