//! "Agentes ao vivo" (administrators): what each AI agent is doing now, pause and resume an agent,
//! stop an answer (the conversation goes to people) and cancel an engine request.
use super::auth::CurrentUser;
use super::error::{done, ok, ApiError, ApiResult};
use super::input::{id, Body};
use super::state::AppState;
use crate::application::engine::EngineService;
use axum::extract::{Path, State};
use axum::response::Response;
use axum::routing::{get, post, put};
use axum::Router;
use serde::Deserialize;

async fn overview(State(state): State<AppState>, current: CurrentUser) -> ApiResult<Response> {
    ok(state.support().live.overview(&current.actor())?)
}

#[derive(Deserialize)]
struct Pause {
    paused: bool,
}

async fn pause(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(raw): Path<String>,
    Body(body): Body<Pause>,
) -> ApiResult<Response> {
    let live = &state.support().live;
    live.set_paused(&current.actor(), id(&raw)?, body.paused)?;
    done()
}

async fn stop_conversation(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(raw): Path<String>,
) -> ApiResult<Response> {
    let live = &state.support().live;
    live.stop_conversation(&current.actor(), id(&raw)?).await?;
    done()
}

async fn stop_chat(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(raw): Path<String>,
) -> ApiResult<Response> {
    state.support().live.stop_chat(&current.actor(), id(&raw)?)?;
    done()
}

async fn cancel(State(state): State<AppState>, current: CurrentUser, Path(raw): Path<String>) -> ApiResult<Response> {
    let account = EngineService::account_of(&current.actor())?;
    let unavailable = ApiError::Status(
        axum::http::StatusCode::SERVICE_UNAVAILABLE,
        "O motor de agentes não está ativo",
    );
    let engine = state.support().engine.get().ok_or(unavailable)?;
    ok(engine.cancel(account, id(&raw)?).await?)
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/agents/live", get(overview))
        .route("/agents/live/{id}/paused", put(pause))
        .route("/agents/live/conversations/{id}/stop", post(stop_conversation))
        .route("/agents/live/chats/{id}/stop", post(stop_chat))
        .route("/engine/activities/{id}/cancel", post(cancel))
}
