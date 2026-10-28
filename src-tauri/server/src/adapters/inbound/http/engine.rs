//! The agentic engine (administrators): activities and their delegations, approvals, each AI agent's
//! policy, tool grants and memory, and the tool and runtime catalog.
use super::auth::CurrentUser;
use super::error::{created, done, ok, ApiError, ApiResult};
use super::input::{id, optional_text, text, Body};
use super::state::AppState;
use crate::application::engine::{EngineService, Submission};
use crate::domain::engine::model::AgentPolicy;
use axum::extract::{Path, State};
use axum::response::Response;
use axum::routing::{get, post, put};
use axum::Router;
use serde::Deserialize;

fn engine(state: &AppState) -> Result<&EngineService, ApiError> {
    let unavailable = ApiError::Status(
        axum::http::StatusCode::SERVICE_UNAVAILABLE,
        "O motor de agentes não está ativo",
    );
    state.support().engine.get().ok_or(unavailable)
}

fn account(current: &CurrentUser) -> Result<i64, ApiError> {
    Ok(EngineService::account_of(&current.actor())?)
}

async fn activities(State(state): State<AppState>, current: CurrentUser) -> ApiResult<Response> {
    ok(engine(&state)?.list(account(&current)?)?)
}

#[derive(Deserialize)]
struct NewActivity {
    agent_id: i64,
    request: String,
    conversation_id: Option<i64>,
    idempotency_key: Option<String>,
}

async fn start(
    State(state): State<AppState>,
    current: CurrentUser,
    Body(body): Body<NewActivity>,
) -> ApiResult<Response> {
    let submission = Submission {
        account_id: account(&current)?,
        agent_id: body.agent_id,
        request: text(&body.request, 1, 4000)?,
        requester: format!("user:{}", current.user.id),
        conversation_id: body.conversation_id,
        idempotency_key: optional_text(body.idempotency_key.as_deref(), 1, 200)?,
        ..Submission::default()
    };
    created(engine(&state)?.start(&submission)?)
}

async fn activity(State(state): State<AppState>, current: CurrentUser, Path(raw): Path<String>) -> ApiResult<Response> {
    ok(engine(&state)?.detail(account(&current)?, id(&raw)?)?)
}

#[derive(Deserialize)]
struct Decision {
    approve: bool,
}

async fn decide(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(raw): Path<String>,
    Body(body): Body<Decision>,
) -> ApiResult<Response> {
    let account = account(&current)?;
    ok(engine(&state)?
        .decide(account, id(&raw)?, body.approve, current.user.id)
        .await?)
}

async fn policy(State(state): State<AppState>, current: CurrentUser, Path(raw): Path<String>) -> ApiResult<Response> {
    ok(engine(&state)?.policy(account(&current)?, id(&raw)?)?)
}

#[derive(Deserialize)]
struct PolicyBody {
    enabled: bool,
    proactive_enabled: bool,
    execution_policy: String,
    max_concurrency: i64,
    run_timeout_secs: i64,
    monthly_token_budget: Option<i64>,
}

async fn save_policy(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(raw): Path<String>,
    Body(body): Body<PolicyBody>,
) -> ApiResult<Response> {
    let in_range = (1..=10).contains(&body.max_concurrency)
        && (10..=3600).contains(&body.run_timeout_secs)
        && body.monthly_token_budget.is_none_or(|b| b >= 0);
    if !in_range {
        return Err(ApiError::Invalid);
    }
    let policy = AgentPolicy {
        agent_id: id(&raw)?,
        account_id: 0,
        enabled: body.enabled,
        proactive_enabled: body.proactive_enabled,
        execution_policy: body.execution_policy,
        max_concurrency: body.max_concurrency,
        run_timeout_secs: body.run_timeout_secs,
        monthly_token_budget: body.monthly_token_budget,
    };
    ok(engine(&state)?.save_policy(account(&current)?, policy)?)
}

#[derive(Deserialize)]
struct Grant {
    tool: String,
    effect: Option<String>,
}

async fn grant(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(raw): Path<String>,
    Body(body): Body<Grant>,
) -> ApiResult<Response> {
    let account = account(&current)?;
    ok(engine(&state)?.grant(account, id(&raw)?, &body.tool, body.effect.as_deref())?)
}

async fn memories(State(state): State<AppState>, current: CurrentUser, Path(raw): Path<String>) -> ApiResult<Response> {
    ok(engine(&state)?.agent_memories(account(&current)?, id(&raw)?)?)
}

#[derive(Deserialize)]
struct Correction {
    content: String,
}

async fn correct(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(raw): Path<String>,
    Body(body): Body<Correction>,
) -> ApiResult<Response> {
    let account = account(&current)?;
    ok(engine(&state)?.correct_memory(account, id(&raw)?, &body.content)?)
}

async fn forget(State(state): State<AppState>, current: CurrentUser, Path(raw): Path<String>) -> ApiResult<Response> {
    engine(&state)?.forget_memory(account(&current)?, id(&raw)?)?;
    done()
}

async fn catalog(State(state): State<AppState>, current: CurrentUser) -> ApiResult<Response> {
    account(&current)?;
    ok(engine(&state)?.catalog())
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/engine/catalog", get(catalog))
        .route("/engine/activities", get(activities).post(start))
        .route("/engine/activities/{id}", get(activity))
        .route("/engine/tool_calls/{id}/decision", post(decide))
        .route("/engine/agents/{id}/policy", get(policy).put(save_policy))
        .route("/engine/agents/{id}/grants", put(grant))
        .route("/engine/agents/{id}/memories", get(memories))
        .route("/engine/memories/{id}", put(correct).delete(forget))
}
