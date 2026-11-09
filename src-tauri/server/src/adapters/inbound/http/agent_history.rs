//! The history on an AI agent's page (administrators): conversations it answered, handoffs to people
//! with their reasons, and schedule runs. What runs now is `/agent_runs`; engine requests are
//! `/engine/activities`.
use super::auth::CurrentUser;
use super::error::{ok, ApiResult};
use super::input::id;
use super::state::AppState;
use axum::extract::{Path, Query as Params, State};
use axum::response::Response;
use axum::routing::get;
use axum::Router;
use serde::Deserialize;

#[derive(Deserialize)]
struct Days {
    days: Option<i64>,
}

/// `?days=` (30 by default).
async fn history(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(agent): Path<String>,
    Params(query): Params<Days>,
) -> ApiResult<Response> {
    let days = query.days.unwrap_or(30);
    ok(state.support().agents.history(&current.actor(), id(&agent)?, days)?)
}

pub fn routes() -> Router<AppState> {
    Router::new().route("/agent_directory/{id}/history", get(history))
}
