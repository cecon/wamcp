//! Macros: CRUD and execution on selected conversations.
use super::auth::CurrentUser;
use super::automation::valid_actions;
use super::error::{created, done, ok, ApiResult};
use super::input::{check, id, ids, one_of, optional_text, text, Body};
use super::state::AppState;
use crate::application::macros::{MacroFields, VISIBILITIES};
use crate::domain::model::Action;
use axum::extract::{Path, State};
use axum::response::Response;
use axum::routing::{get, patch, post};
use axum::Router;
use serde::Deserialize;

#[derive(Deserialize)]
struct Fields {
    name: Option<String>,
    visibility: Option<String>,
    actions: Option<Vec<Action>>,
}

fn fields(body: Fields) -> ApiResult<MacroFields> {
    check(body.actions.as_deref().is_none_or(valid_actions))?;
    Ok(MacroFields {
        name: optional_text(body.name.as_deref(), 1, 120)?,
        visibility: body
            .visibility
            .as_deref()
            .map(|v| one_of(v, &VISIBILITIES))
            .transpose()?,
        actions: body.actions,
    })
}

async fn list(State(state): State<AppState>, current: CurrentUser) -> ApiResult<Response> {
    ok(state.support().helpdesk.macros(&current.actor())?)
}

async fn create(State(state): State<AppState>, current: CurrentUser, Body(body): Body<Fields>) -> ApiResult<Response> {
    text(body.name.as_deref().unwrap_or_default(), 1, 120)?;
    check(body.actions.is_some())?;
    created(
        state
            .support()
            .helpdesk
            .create_macro(&current.actor(), &fields(body)?)?,
    )
}

async fn update(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(m): Path<String>,
    Body(body): Body<Fields>,
) -> ApiResult<Response> {
    ok(state
        .support()
        .helpdesk
        .update_macro(&current.actor(), id(&m)?, &fields(body)?)?)
}

async fn remove(State(state): State<AppState>, current: CurrentUser, Path(m): Path<String>) -> ApiResult<Response> {
    state.support().helpdesk.delete_macro(&current.actor(), id(&m)?)?;
    done()
}

#[derive(Deserialize)]
struct Execute {
    conversation_ids: Vec<i64>,
}

async fn execute(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(m): Path<String>,
    Body(body): Body<Execute>,
) -> ApiResult<Response> {
    let conversations = ids(&body.conversation_ids, 1, 100)?;
    ok(state
        .support()
        .helpdesk
        .execute_macro(&current.actor(), id(&m)?, &conversations)
        .await?)
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/macros", get(list).post(create))
        .route("/macros/{id}", patch(update).delete(remove))
        .route("/macros/{id}/execute", post(execute))
}
