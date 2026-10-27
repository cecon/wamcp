//! Custom roles (administrators).
use super::auth::CurrentUser;
use super::error::{created, done, ok, ApiResult};
use super::input::{id, nullable_text, text, Body};
use super::state::AppState;
use crate::domain::model::CustomRole;
use axum::extract::{Path, State};
use axum::response::Response;
use axum::routing::get;
use axum::Router;
use serde::Deserialize;

#[derive(Deserialize)]
struct Role {
    name: Option<String>,
    #[serde(default, deserialize_with = "crate::domain::model::nullable")]
    description: Option<Option<String>>,
    #[serde(default)]
    permissions: Vec<String>,
    /// The AI role agents with this profile play (`null` for none).
    agent_role: Option<String>,
    /// Skills every agent of the profile inherits (omitted: unchanged).
    skill_ids: Option<Vec<i64>>,
}

fn role(id: i64, body: Role) -> ApiResult<(CustomRole, Option<Vec<i64>>)> {
    let skills = body.skill_ids;
    let role = CustomRole {
        id,
        name: text(body.name.as_deref().unwrap_or_default(), 1, 60)?,
        description: nullable_text(body.description, 300)?.flatten(),
        permissions: body.permissions,
        agent_role: body.agent_role.filter(|r| !r.is_empty()),
        builtin: false,
        skill_ids: Vec::new(),
        created: String::new(),
    };
    Ok((role, skills))
}

async fn list(State(state): State<AppState>, current: CurrentUser) -> ApiResult<Response> {
    ok(state.support().accounts.custom_roles(&current.actor())?)
}

async fn create(State(state): State<AppState>, current: CurrentUser, Body(body): Body<Role>) -> ApiResult<Response> {
    let (role, skills) = role(0, body)?;
    let accounts = &state.support().accounts;
    created(accounts.save_custom_role(&current.actor(), &role, skills.as_deref())?)
}

/// Replaces the role (name, description and the full permission list).
async fn update(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(r): Path<String>,
    Body(body): Body<Role>,
) -> ApiResult<Response> {
    let (role, skills) = role(id(&r)?, body)?;
    let accounts = &state.support().accounts;
    ok(accounts.save_custom_role(&current.actor(), &role, skills.as_deref())?)
}

async fn remove(State(state): State<AppState>, current: CurrentUser, Path(r): Path<String>) -> ApiResult<Response> {
    state.support().accounts.delete_custom_role(&current.actor(), id(&r)?)?;
    done()
}

pub fn routes() -> Router<AppState> {
    Router::new().route("/custom_roles", get(list).post(create)).route(
        "/custom_roles/{id}",
        axum::routing::put(update).patch(update).delete(remove),
    )
}
