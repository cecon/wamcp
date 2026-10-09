//! The agent's notifications: list, read/unread, snooze, delete and preferences.
use super::auth::CurrentUser;
use super::error::{ok, ApiResult};
use super::input::{check, id, Body};
use super::state::AppState;
use axum::extract::{Path, State};
use axum::response::Response;
use axum::routing::{get, patch, post};
use axum::Router;
use serde::Deserialize;
use serde_json::{Map, Value};

async fn list(State(state): State<AppState>, current: CurrentUser) -> ApiResult<Response> {
    ok(state.support().notifications.list(&current.user)?)
}

async fn unread(State(state): State<AppState>, current: CurrentUser) -> ApiResult<Response> {
    ok(state.support().notifications.unread_count(&current.user)?)
}

async fn read_all(State(state): State<AppState>, current: CurrentUser) -> ApiResult<Response> {
    ok(state.support().notifications.read_all(&current.user)?)
}

async fn delete_all(State(state): State<AppState>, current: CurrentUser) -> ApiResult<Response> {
    ok(state.support().notifications.delete_all(&current.user)?)
}

async fn read(State(state): State<AppState>, current: CurrentUser, Path(n): Path<String>) -> ApiResult<Response> {
    ok(state.support().notifications.read(&current.user, id(&n)?)?)
}

async fn mark_unread(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(n): Path<String>,
) -> ApiResult<Response> {
    ok(state.support().notifications.mark_unread(&current.user, id(&n)?)?)
}

async fn remove(State(state): State<AppState>, current: CurrentUser, Path(n): Path<String>) -> ApiResult<Response> {
    ok(state.support().notifications.delete(&current.user, id(&n)?)?)
}

#[derive(Deserialize)]
struct Snooze {
    snoozed_until: i64,
}

async fn snooze(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(n): Path<String>,
    Body(body): Body<Snooze>,
) -> ApiResult<Response> {
    ok(state
        .support()
        .notifications
        .snooze(&current.user, id(&n)?, body.snoozed_until)?)
}

async fn settings(State(state): State<AppState>, current: CurrentUser) -> ApiResult<Response> {
    ok(state.support().notifications.settings(&current.user)?)
}

#[derive(Deserialize)]
struct Settings {
    flags: Map<String, Value>,
}

async fn update_settings(
    State(state): State<AppState>,
    current: CurrentUser,
    Body(body): Body<Settings>,
) -> ApiResult<Response> {
    check(body.flags.len() <= 20)?;
    ok(state
        .support()
        .notifications
        .update_settings(&current.user, &body.flags)?)
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/notifications", get(list))
        .route("/notifications/unread_count", get(unread))
        .route("/notifications/read_all", post(read_all))
        .route("/notifications/destroy_all", post(delete_all))
        .route("/notifications/{id}", patch(read).delete(remove))
        .route("/notifications/{id}/unread", post(mark_unread))
        .route("/notifications/{id}/snooze", post(snooze))
        .route("/notification_settings", get(settings).patch(update_settings))
}
