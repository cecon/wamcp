//! The store (administrators): the catalog with what is installed here, installing a skill and
//! creating an agent from a template; and the catalog's address.
use super::auth::CurrentUser;
use super::error::{created, ok, ApiResult};
use super::input::Body;
use super::state::AppState;
use crate::application::store::AgentRequest;
use axum::extract::{Path, State};
use axum::response::Response;
use axum::routing::{get, post, put};
use axum::Router;
use serde::Deserialize;
use serde_json::json;

async fn catalog(State(state): State<AppState>, current: CurrentUser) -> ApiResult<Response> {
    ok(state.support().store.catalog(&current.actor()).await?)
}

#[derive(Deserialize)]
struct Source {
    /// `null` or empty goes back to the app's catalog.
    url: Option<String>,
}

async fn set_source(
    State(state): State<AppState>,
    current: CurrentUser,
    Body(body): Body<Source>,
) -> ApiResult<Response> {
    let source = state
        .support()
        .store
        .set_source(&current.actor(), body.url.as_deref())?;
    ok(json!({ "source": source }))
}

async fn install_plugin(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(id): Path<String>,
) -> ApiResult<Response> {
    created(state.support().store.install_plugin(&current.actor(), &id).await?)
}

async fn preview_agent(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(id): Path<String>,
) -> ApiResult<Response> {
    ok(state.support().store.preview_agent(&current.actor(), &id).await?)
}

async fn install_agent(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(id): Path<String>,
    Body(body): Body<AgentRequest>,
) -> ApiResult<Response> {
    created(
        state
            .support()
            .store
            .install_agent(&current.actor(), &id, &body)
            .await?,
    )
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/store", get(catalog))
        .route("/store/source", put(set_source))
        .route("/store/plugins/{id}", post(install_plugin))
        .route("/store/agents/{id}", get(preview_agent).post(install_agent))
}
