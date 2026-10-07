//! SLA policies, the SLA of a conversation and SLA metrics.
use super::auth::CurrentUser;
use super::error::{created, done, ok, ApiResult};
use super::input::{id, int_param, nullable_text, optional_id, text, Body, Query};
use super::state::AppState;
use crate::domain::model::SlaPolicy;
use axum::extract::{Path, Query as Params, State};
use axum::response::Response;
use axum::routing::get;
use axum::Router;
use serde::Deserialize;

#[derive(Deserialize)]
struct Policy {
    name: Option<String>,
    #[serde(default, deserialize_with = "crate::domain::model::nullable")]
    description: Option<Option<String>>,
    first_response_time_threshold: Option<i64>,
    next_response_time_threshold: Option<i64>,
    resolution_time_threshold: Option<i64>,
}

fn policy(id: i64, body: Policy) -> ApiResult<SlaPolicy> {
    Ok(SlaPolicy {
        id,
        name: text(body.name.as_deref().unwrap_or_default(), 1, 80)?,
        description: nullable_text(body.description, 500)?.flatten(),
        first_response_time_threshold: body.first_response_time_threshold,
        next_response_time_threshold: body.next_response_time_threshold,
        resolution_time_threshold: body.resolution_time_threshold,
        created: String::new(),
    })
}

async fn list(State(state): State<AppState>, _user: CurrentUser) -> ApiResult<Response> {
    ok(state.support().helpdesk.sla_policies()?)
}

async fn create(State(state): State<AppState>, current: CurrentUser, Body(body): Body<Policy>) -> ApiResult<Response> {
    created(
        state
            .support()
            .helpdesk
            .create_sla_policy(&current.actor(), &policy(0, body)?)?,
    )
}

/// Replaces the policy (send every target; omitted ones are cleared).
async fn update(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(sla): Path<String>,
    Body(body): Body<Policy>,
) -> ApiResult<Response> {
    let policy = policy(id(&sla)?, body)?;
    ok(state.support().helpdesk.update_sla_policy(&current.actor(), &policy)?)
}

async fn remove(State(state): State<AppState>, current: CurrentUser, Path(sla): Path<String>) -> ApiResult<Response> {
    state
        .support()
        .helpdesk
        .delete_sla_policy(&current.actor(), id(&sla)?)?;
    done()
}

async fn show(State(state): State<AppState>, current: CurrentUser, Path(display): Path<String>) -> ApiResult<Response> {
    ok(state
        .support()
        .helpdesk
        .conversation_sla(&current.actor(), id(&display)?)?)
}

#[derive(Deserialize)]
struct Apply {
    sla_policy_id: i64,
}

async fn apply(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(display): Path<String>,
    Body(body): Body<Apply>,
) -> ApiResult<Response> {
    ok(state
        .support()
        .helpdesk
        .apply_sla(&current.actor(), id(&display)?, body.sla_policy_id)?)
}

async fn metrics(
    State(state): State<AppState>,
    current: CurrentUser,
    Params(query): Params<Query>,
) -> ApiResult<Response> {
    let until = optional_id(&query, "until")?.unwrap_or(i64::MAX / 2);
    let since = int_param(&query, "since", 0, 0, i64::MAX / 2)?;
    ok(state.support().helpdesk.sla_metrics(&current.actor(), since, until)?)
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/sla_policies", get(list).post(create))
        .route(
            "/sla_policies/{id}",
            axum::routing::put(update).patch(update).delete(remove),
        )
        .route("/conversations/{id}/sla", get(show).post(apply))
        .route("/applied_slas/metrics", get(metrics))
}
