//! Agent bots (administrators): CRUD, access token reset, deliveries and inbox connection.
use super::auth::CurrentUser;
use super::error::{created, done, ok, ApiResult};
use super::input::{id, nullable_text, optional_text, text, Body};
use super::state::AppState;
use crate::application::agent_bots::BotFields;
use axum::extract::{Path, State};
use axum::response::Response;
use axum::routing::{get, patch, post};
use axum::Router;
use serde::Deserialize;

#[derive(Deserialize)]
struct Fields {
    name: Option<String>,
    #[serde(default, deserialize_with = "crate::domain::model::nullable")]
    description: Option<Option<String>>,
    outgoing_url: Option<String>,
}

fn fields(body: Fields) -> ApiResult<BotFields> {
    Ok(BotFields {
        name: optional_text(body.name.as_deref(), 1, 80)?,
        description: nullable_text(body.description, 500)?,
        outgoing_url: body.outgoing_url,
    })
}

async fn list(State(state): State<AppState>, current: CurrentUser) -> ApiResult<Response> {
    ok(state.support().webhooks.agent_bots(&current.actor())?)
}

async fn create(State(state): State<AppState>, current: CurrentUser, Body(body): Body<Fields>) -> ApiResult<Response> {
    text(body.name.as_deref().unwrap_or_default(), 1, 80)?;
    created(
        state
            .support()
            .webhooks
            .create_agent_bot(&current.actor(), &fields(body)?)?,
    )
}

async fn update(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(bot): Path<String>,
    Body(body): Body<Fields>,
) -> ApiResult<Response> {
    ok(state
        .support()
        .webhooks
        .update_agent_bot(&current.actor(), id(&bot)?, &fields(body)?)?)
}

async fn remove(State(state): State<AppState>, current: CurrentUser, Path(bot): Path<String>) -> ApiResult<Response> {
    state.support().webhooks.delete_agent_bot(&current.actor(), id(&bot)?)?;
    done()
}

async fn reset_token(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(bot): Path<String>,
) -> ApiResult<Response> {
    ok(state.support().webhooks.reset_bot_token(&current.actor(), id(&bot)?)?)
}

async fn deliveries(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(bot): Path<String>,
) -> ApiResult<Response> {
    ok(state.support().webhooks.bot_deliveries(&current.actor(), id(&bot)?)?)
}

#[derive(Deserialize)]
struct Connect {
    #[serde(deserialize_with = "crate::domain::model::nullable")]
    agent_bot_id: Option<Option<i64>>,
}

async fn connect(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(inbox): Path<String>,
    Body(body): Body<Connect>,
) -> ApiResult<Response> {
    let bot = body.agent_bot_id.ok_or(super::error::ApiError::Invalid)?;
    ok(state
        .support()
        .webhooks
        .set_inbox_bot(&current.actor(), id(&inbox)?, bot)?)
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/agent_bots", get(list).post(create))
        .route("/agent_bots/{id}", patch(update).delete(remove))
        .route("/agent_bots/{id}/reset_access_token", post(reset_token))
        .route("/agent_bots/{id}/deliveries", get(deliveries))
        .route("/inboxes/{id}/agent_bot", post(connect))
}
