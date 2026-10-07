//! Two-factor authentication, active sessions and the audit log.
use super::accounts::signed_in;
use super::auth::{read_cookie, CurrentUser, SESSION_COOKIE};
use super::error::{done, ok, ApiResult};
use super::input::{id, int_param, raw, text, Body, Query};
use super::rate_limit::{client_key, Peer};
use super::state::AppState;
use axum::extract::{Path, Query as Params, State};
use axum::http::{header, HeaderMap};
use axum::response::Response;
use axum::routing::{delete, get, post};
use axum::Router;
use serde::Deserialize;
use serde_json::json;

#[derive(Deserialize)]
struct Challenge {
    mfa_token: String,
    code: String,
}

/// Second login step for agents with two-factor authentication.
async fn complete(
    State(state): State<AppState>,
    peer: Peer,
    headers: HeaderMap,
    Body(body): Body<Challenge>,
) -> ApiResult<Response> {
    if let Some(limited) = state.limits.login.reject(&client_key(&headers, peer.0)) {
        return Ok(limited);
    }
    let (token, code) = (raw(&body.mfa_token, 1, 128)?, raw(&body.code, 1, 20)?);
    let agent = headers.get(header::USER_AGENT).and_then(|v| v.to_str().ok());
    let session = state.support().accounts.complete_mfa(&token, &code, agent)?;
    signed_in(&state, session)
}

async fn status(current: CurrentUser) -> ApiResult<Response> {
    ok(json!({ "enabled": current.user.mfa_enabled != 0 }))
}

async fn setup(State(state): State<AppState>, current: CurrentUser) -> ApiResult<Response> {
    ok(state.support().accounts.setup_mfa(&current.user)?)
}

#[derive(Deserialize)]
struct Code {
    code: String,
    password: Option<String>,
}

async fn enable(State(state): State<AppState>, current: CurrentUser, Body(body): Body<Code>) -> ApiResult<Response> {
    let code = text(&body.code, 1, 20)?;
    ok(state.support().accounts.enable_mfa(&current.user, &code)?)
}

async fn disable(State(state): State<AppState>, current: CurrentUser, Body(body): Body<Code>) -> ApiResult<Response> {
    let password = raw(body.password.as_deref().unwrap_or_default(), 1, 200)?;
    let code = text(&body.code, 1, 20)?;
    state
        .support()
        .accounts
        .disable_mfa(&current.user, &password, &code)
        .await?;
    done()
}

async fn reset(State(state): State<AppState>, current: CurrentUser, Path(agent): Path<String>) -> ApiResult<Response> {
    state.support().accounts.reset_mfa(&current.actor(), id(&agent)?)?;
    done()
}

async fn sessions(State(state): State<AppState>, current: CurrentUser, headers: HeaderMap) -> ApiResult<Response> {
    let cookie = read_cookie(&headers, SESSION_COOKIE);
    ok(state.support().accounts.sessions(&current.user, cookie.as_deref())?)
}

async fn revoke_others(State(state): State<AppState>, current: CurrentUser, headers: HeaderMap) -> ApiResult<Response> {
    let cookie = read_cookie(&headers, SESSION_COOKIE).unwrap_or_default();
    state.support().accounts.revoke_other_sessions(&current.user, &cookie)?;
    done()
}

async fn revoke(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(session): Path<String>,
) -> ApiResult<Response> {
    let session = text(&session, 64, 64)?;
    state.support().accounts.revoke_session(&current.user, &session)?;
    done()
}

async fn audit_logs(
    State(state): State<AppState>,
    current: CurrentUser,
    Params(query): Params<Query>,
) -> ApiResult<Response> {
    let page = int_param(&query, "page", 1, 1, 10_000)?;
    ok(state.support().accounts.audit_logs(&current.actor(), page)?)
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/auth/mfa", post(complete))
        .route("/profile/mfa", get(status).post(setup).delete(disable))
        .route("/profile/mfa/verify", post(enable))
        .route("/profile/sessions", get(sessions).delete(revoke_others))
        .route("/profile/sessions/{id}", delete(revoke))
        .route("/agents/{id}/mfa", delete(reset))
        .route("/audit_logs", get(audit_logs))
}
