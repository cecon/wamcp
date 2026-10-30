//! Chats of the person logged in with AI agents: who they may talk to, the messages of a chat and
//! sending one (the agent's answer arrives on the events stream as `agent_chat.message`), and the
//! chat's sessions (ending one starts the next).
use super::auth::CurrentUser;
use super::error::{created, ok, ApiResult};
use super::input::{id, Body};
use super::state::AppState;
use axum::extract::{Path, Query, State};
use axum::response::Response;
use axum::routing::get;
use axum::Router;
use serde::Deserialize;

async fn contacts(State(state): State<AppState>, current: CurrentUser) -> ApiResult<Response> {
    ok(state.support().chats.contacts(&current.user)?)
}

#[derive(Deserialize)]
struct Session {
    session: Option<i64>,
}

async fn messages(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(agent): Path<String>,
    Query(query): Query<Session>,
) -> ApiResult<Response> {
    ok(state
        .support()
        .chats
        .messages(&current.user, id(&agent)?, query.session)?)
}

async fn sessions(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(agent): Path<String>,
) -> ApiResult<Response> {
    ok(state.support().chats.sessions(&current.user, id(&agent)?)?)
}

async fn new_session(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(agent): Path<String>,
) -> ApiResult<Response> {
    created(state.support().chats.new_session(&current.user, id(&agent)?)?)
}

#[derive(Deserialize)]
struct Send {
    content: String,
}

async fn send(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(agent): Path<String>,
    Body(body): Body<Send>,
) -> ApiResult<Response> {
    created(state.support().chats.send(&current.user, id(&agent)?, &body.content)?)
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/agent_chats", get(contacts))
        .route("/agent_chats/{agent_id}/messages", get(messages).post(send))
        .route("/agent_chats/{agent_id}/sessions", get(sessions).post(new_session))
}
