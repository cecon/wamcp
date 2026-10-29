//! Schedules AI agents subscribe to (administrators): CRUD, subscriptions, run history, "run now"
//! and a preview of the next runs for the cron helper.
use super::auth::CurrentUser;
use super::error::{created, done, ok, ApiResult};
use super::input::{id, Body};
use super::state::AppState;
use crate::application::agent_schedules::ScheduleFields;
use axum::extract::{Path, State};
use axum::response::Response;
use axum::routing::{get, patch, post, put};
use axum::Router;
use serde::Deserialize;

#[derive(Deserialize)]
struct Fields {
    name: Option<String>,
    #[serde(default, deserialize_with = "crate::domain::model::nullable")]
    cron: Option<Option<String>>,
    #[serde(default, deserialize_with = "crate::domain::model::nullable")]
    interval_minutes: Option<Option<i64>>,
    timezone: Option<String>,
    prompt: Option<String>,
    active: Option<bool>,
    agent_ids: Option<Vec<i64>>,
}

impl From<Fields> for ScheduleFields {
    fn from(body: Fields) -> Self {
        Self {
            name: body.name,
            cron: body.cron,
            interval_minutes: body.interval_minutes,
            timezone: body.timezone,
            prompt: body.prompt,
            active: body.active,
            agent_ids: body.agent_ids,
        }
    }
}

async fn list(State(state): State<AppState>, current: CurrentUser) -> ApiResult<Response> {
    ok(state.support().schedules.list(&current.actor())?)
}

async fn create(State(state): State<AppState>, current: CurrentUser, Body(body): Body<Fields>) -> ApiResult<Response> {
    created(state.support().schedules.create(&current.actor(), &body.into())?)
}

async fn update(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(schedule): Path<String>,
    Body(body): Body<Fields>,
) -> ApiResult<Response> {
    ok(state
        .support()
        .schedules
        .update(&current.actor(), id(&schedule)?, &body.into())?)
}

async fn remove(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(schedule): Path<String>,
) -> ApiResult<Response> {
    state.support().schedules.delete(&current.actor(), id(&schedule)?)?;
    done()
}

async fn subscribe(
    State(state): State<AppState>,
    current: CurrentUser,
    Path((schedule, agent)): Path<(String, String)>,
) -> ApiResult<Response> {
    ok(state
        .support()
        .schedules
        .subscribe(&current.actor(), id(&schedule)?, id(&agent)?, true)?)
}

async fn unsubscribe(
    State(state): State<AppState>,
    current: CurrentUser,
    Path((schedule, agent)): Path<(String, String)>,
) -> ApiResult<Response> {
    ok(state
        .support()
        .schedules
        .subscribe(&current.actor(), id(&schedule)?, id(&agent)?, false)?)
}

async fn runs(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(schedule): Path<String>,
) -> ApiResult<Response> {
    ok(state.support().schedules.runs(&current.actor(), id(&schedule)?)?)
}

async fn run_now(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(schedule): Path<String>,
) -> ApiResult<Response> {
    created(state.support().schedules.run_now(&current.actor(), id(&schedule)?)?)
}

async fn preview(State(state): State<AppState>, current: CurrentUser, Body(body): Body<Fields>) -> ApiResult<Response> {
    ok(state.support().schedules.preview(&current.actor(), &body.into())?)
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/agent_schedules", get(list).post(create))
        .route("/agent_schedules/preview", post(preview))
        .route("/agent_schedules/{id}", patch(update).delete(remove))
        .route("/agent_schedules/{id}/runs", get(runs).post(run_now))
        .route(
            "/agent_schedules/{id}/agents/{agent_id}",
            put(subscribe).delete(unsubscribe),
        )
}
