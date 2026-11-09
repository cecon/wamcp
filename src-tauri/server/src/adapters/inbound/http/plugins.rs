//! Plugins (administrators): list, install from a manifest, turn on or off, fill in the
//! credentials their tools use, update the ones installed from an address and remove them.
use super::auth::CurrentUser;
use super::error::{created, done, ok, ApiResult};
use super::input::Body;
use super::state::AppState;
use axum::extract::{Path, State};
use axum::response::Response;
use axum::routing::{get, patch, post, put};
use axum::Router;
use serde::Deserialize;
use serde_json::Value;

async fn list(State(state): State<AppState>, current: CurrentUser) -> ApiResult<Response> {
    ok(state.support().plugins.list(&current.actor())?)
}

async fn install(
    State(state): State<AppState>,
    current: CurrentUser,
    Body(manifest): Body<Value>,
) -> ApiResult<Response> {
    let plugins = &state.support().plugins;
    // `{"url": "https://…/plugin.json"}` installs from an address (and remembers it for updates).
    match manifest
        .get("url")
        .and_then(Value::as_str)
        .filter(|_| manifest.get("id").is_none())
    {
        Some(url) => created(plugins.install_from(&current.actor(), url).await?),
        None => created(plugins.install(&current.actor(), &manifest)?),
    }
}

async fn update(State(state): State<AppState>, current: CurrentUser, Path(id): Path<String>) -> ApiResult<Response> {
    ok(state.support().plugins.update(&current.actor(), &id).await?)
}

#[derive(Deserialize)]
struct Toggle {
    enabled: bool,
}

async fn toggle(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(id): Path<String>,
    Body(body): Body<Toggle>,
) -> ApiResult<Response> {
    ok(state
        .support()
        .plugins
        .set_enabled(&current.actor(), &id, body.enabled)?)
}

async fn remove(State(state): State<AppState>, current: CurrentUser, Path(id): Path<String>) -> ApiResult<Response> {
    state.support().plugins.remove(&current.actor(), &id)?;
    done()
}

#[derive(Deserialize)]
struct Credential {
    /// Empty or `null` clears the stored value.
    value: Option<String>,
}

async fn credential(
    State(state): State<AppState>,
    current: CurrentUser,
    Path((id, name)): Path<(String, String)>,
    Body(body): Body<Credential>,
) -> ApiResult<Response> {
    let plugins = &state.support().plugins;
    ok(plugins.set_credential(&current.actor(), &id, &name, body.value.as_deref())?)
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/plugins", get(list).post(install))
        .route("/plugins/{id}", patch(toggle).delete(remove))
        .route("/plugins/{id}/update", post(update))
        .route("/plugins/{id}/credentials/{name}", put(credential))
}
