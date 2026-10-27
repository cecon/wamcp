//! AI agents at work (administrators): which runtimes are installed on this computer and which AI
//! agent answers each inbox.
use super::auth::CurrentUser;
use super::error::{ok, ApiError, ApiResult};
use super::input::{id, Body};
use super::state::AppState;
use axum::extract::{Path, State};
use axum::response::Response;
use axum::routing::{get, post};
use axum::Router;
use serde::Deserialize;

async fn runtimes(State(state): State<AppState>, current: CurrentUser) -> ApiResult<Response> {
    ok(state.support().agents.runtimes(&current.actor())?)
}

#[derive(Deserialize)]
struct Connect {
    #[serde(deserialize_with = "crate::domain::model::nullable")]
    ai_agent_id: Option<Option<i64>>,
}

async fn connect(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(inbox): Path<String>,
    Body(body): Body<Connect>,
) -> ApiResult<Response> {
    let agent = body.ai_agent_id.ok_or(ApiError::Invalid)?;
    ok(state
        .support()
        .agents
        .connect_inbox(&current.actor(), id(&inbox)?, agent)?)
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/agent_runtimes", get(runtimes))
        .route("/inboxes/{id}/ai_agent", post(connect))
}
