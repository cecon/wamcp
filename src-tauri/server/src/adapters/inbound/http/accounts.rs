//! Auth, profile and agents under /api/v1, plus the desktop-only bootstrap of the first admin.
use super::auth::{read_cookie, session_cookie, CurrentUser, SESSION_COOKIE};
use super::error::{created, done, ok, ApiResult};
use super::input::{check, email, id, nullable_text, one_of, raw, text, Body};
use super::rate_limit::{client_key, Peer};
use super::state::AppState;
use crate::application::accounts::{self, AgentChanges, NewAgent, ProfileChanges, SESSION_TTL_MS};
use crate::application::security::LoginOutcome;
use crate::domain::helpdesk::{AVAILABILITY, ROLES};
use axum::extract::{Path, State};
use axum::http::{header, HeaderMap};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, patch, post};
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::json;

#[derive(Deserialize)]
struct Login {
    email: String,
    password: String,
}

async fn login(
    State(state): State<AppState>,
    peer: Peer,
    headers: HeaderMap,
    Body(body): Body<Login>,
) -> ApiResult<Response> {
    if let Some(limited) = state.limits.login.reject(&client_key(&headers, peer.0)) {
        return Ok(limited);
    }
    let address = email(&body.email)?;
    raw(&body.password, 1, 200)?;
    let accounts = &state.support().accounts;
    let agent = headers.get(header::USER_AGENT).and_then(|v| v.to_str().ok());
    match accounts.login(&address, &body.password, agent).await? {
        LoginOutcome::Session(session) => signed_in(&state, *session),
        LoginOutcome::Mfa { token } => ok(json!({ "mfa_required": true, "mfa_token": token })),
    }
}

/// The login response: the agent, its CSRF token and the session cookie.
pub(super) fn signed_in(state: &AppState, session: accounts::Login) -> ApiResult<Response> {
    let me = state.support().accounts.me(&session.user)?;
    let mut response = Json(json!({ "user": me, "csrf": session.csrf })).into_response();
    response
        .headers_mut()
        .insert(header::SET_COOKIE, session_cookie(&session.cookie, SESSION_TTL_MS));
    Ok(response)
}

async fn logout(State(state): State<AppState>, headers: HeaderMap, _user: CurrentUser) -> ApiResult<Response> {
    if let Some(cookie) = read_cookie(&headers, SESSION_COOKIE) {
        state.support().accounts.logout(&cookie)?;
    }
    let mut response = Json(json!({ "ok": true })).into_response();
    response.headers_mut().insert(header::SET_COOKIE, session_cookie("", 0));
    Ok(response)
}

async fn me(State(state): State<AppState>, current: CurrentUser) -> ApiResult<Response> {
    ok(json!({ "user": state.support().accounts.me(&current.user)?, "csrf": current.csrf }))
}

#[derive(Deserialize)]
struct Profile {
    name: Option<String>,
    #[serde(default, deserialize_with = "crate::domain::model::nullable")]
    display_name: Option<Option<String>>,
    availability: Option<String>,
    current_password: Option<String>,
    password: Option<String>,
}

async fn update_profile(
    State(state): State<AppState>,
    current: CurrentUser,
    Body(body): Body<Profile>,
) -> ApiResult<Response> {
    let changes = ProfileChanges {
        name: body.name.as_deref().map(|n| text(n, 1, 80)).transpose()?,
        display_name: nullable_text(body.display_name, 80)?,
        availability: body
            .availability
            .as_deref()
            .map(|a| one_of(a, &AVAILABILITY))
            .transpose()?,
        current_password: body.current_password.as_deref().map(|p| raw(p, 0, 200)).transpose()?,
        password: body.password.as_deref().map(|p| raw(p, 10, 200)).transpose()?,
    };
    ok(state.support().accounts.update_profile(&current.user, changes).await?)
}

async fn access_token(State(state): State<AppState>, current: CurrentUser) -> ApiResult<Response> {
    created(state.support().accounts.issue_api_token(&current.user)?)
}

async fn agents(State(state): State<AppState>, _user: CurrentUser) -> ApiResult<Response> {
    ok(state.support().accounts.agents()?)
}

#[derive(Deserialize)]
struct NewAgentBody {
    name: String,
    email: String,
    role: Option<String>,
    password: String,
    #[serde(default)]
    inbox_ids: Vec<i64>,
}

async fn create_agent(
    State(state): State<AppState>,
    current: CurrentUser,
    Body(body): Body<NewAgentBody>,
) -> ApiResult<Response> {
    check(body.inbox_ids.len() <= 100 && body.inbox_ids.iter().all(|i| *i > 0))?;
    let agent = NewAgent {
        name: text(&body.name, 1, 80)?,
        email: email(&body.email)?,
        role: one_of(body.role.as_deref().unwrap_or("agent"), &ROLES)?,
        password: raw(&body.password, 10, 200)?,
        inbox_ids: body.inbox_ids,
    };
    created(state.support().accounts.create_agent(&current.actor(), agent).await?)
}

#[derive(Deserialize)]
struct AgentBody {
    name: Option<String>,
    #[serde(default, deserialize_with = "crate::domain::model::nullable")]
    display_name: Option<Option<String>>,
    role: Option<String>,
    active: Option<bool>,
    password: Option<String>,
    #[serde(default, deserialize_with = "crate::domain::model::nullable")]
    custom_role_id: Option<Option<i64>>,
}

async fn update_agent(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(agent): Path<String>,
    Body(body): Body<AgentBody>,
) -> ApiResult<Response> {
    let changes = AgentChanges {
        name: body.name.as_deref().map(|n| text(n, 1, 80)).transpose()?,
        display_name: nullable_text(body.display_name, 80)?,
        role: body.role.as_deref().map(|r| one_of(r, &ROLES)).transpose()?,
        active: body.active,
        password: body.password.as_deref().map(|p| raw(p, 10, 200)).transpose()?,
        custom_role_id: body.custom_role_id,
    };
    let id = id(&agent)?;
    ok(state
        .support()
        .accounts
        .update_agent(&current.actor(), id, changes)
        .await?)
}

async fn delete_agent(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(agent): Path<String>,
) -> ApiResult<Response> {
    state.support().accounts.delete_agent(&current.actor(), id(&agent)?)?;
    done()
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/auth/login", post(login))
        .route("/auth/logout", post(logout))
        .route("/auth/me", get(me))
        .route("/profile", patch(update_profile))
        .route("/profile/access_token", post(access_token))
        .route("/agents", get(agents).post(create_agent))
        .route("/agents/{id}", patch(update_agent).delete(delete_agent))
}

#[derive(Deserialize)]
struct Bootstrap {
    name: String,
    email: String,
    password: String,
}

async fn helpdesk_status(State(state): State<AppState>) -> ApiResult<Response> {
    let needs = state.support().accounts.needs_bootstrap()?;
    ok(json!({ "needsBootstrap": needs, "webUrl": format!("{}/app/", state.public_url) }))
}

async fn bootstrap(State(state): State<AppState>, Body(body): Body<Bootstrap>) -> ApiResult<Response> {
    let (name, address, password) = (
        text(&body.name, 1, 80)?,
        email(&body.email)?,
        raw(&body.password, 10, 200)?,
    );
    created(state.support().accounts.bootstrap(&name, &address, &password).await?)
}

/// Desktop-only (admin token) endpoints to create the first administrator.
pub fn bootstrap_routes() -> Router<AppState> {
    Router::new()
        .route("/api/helpdesk/status", get(helpdesk_status))
        .route("/api/helpdesk/bootstrap", post(bootstrap))
}
