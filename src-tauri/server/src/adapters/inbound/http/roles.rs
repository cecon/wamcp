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
}

fn role(id: i64, body: Role) -> ApiResult<CustomRole> {
    Ok(CustomRole {
        id,
        name: text(body.name.as_deref().unwrap_or_default(), 1, 60)?,
        description: nullable_text(body.description, 300)?.flatten(),
        permissions: body.permissions,
        created: String::new(),
    })
}

async fn list(State(state): State<AppState>, current: CurrentUser) -> ApiResult<Response> {
    ok(state.support().accounts.custom_roles(&current.actor())?)
}

async fn create(State(state): State<AppState>, current: CurrentUser, Body(body): Body<Role>) -> ApiResult<Response> {
    created(
        state
            .support()
            .accounts
            .save_custom_role(&current.actor(), &role(0, body)?)?,
    )
}

/// Replaces the role (name, description and the full permission list).
async fn update(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(r): Path<String>,
    Body(body): Body<Role>,
) -> ApiResult<Response> {
    let role = role(id(&r)?, body)?;
    ok(state.support().accounts.save_custom_role(&current.actor(), &role)?)
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
