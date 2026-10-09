//! Catalog items (`/catalog/items`) and groups of options (`/catalog/groups`).
use super::auth::CurrentUser;
use super::error::{created, done, ok, ApiResult};
use super::input::{id, ids, one_of, optional_id, text, Body, Query};
use super::state::AppState;
use crate::domain::menu::patch::{GroupPatch, ItemPatch};
use crate::domain::menu::STATUSES;
use axum::extract::{Path, Query as Params, State};
use axum::response::Response;
use axum::routing::{get, post};
use axum::Router;
use serde::Deserialize;

/// `?category_id=&q=&status=`.
async fn list(
    State(state): State<AppState>,
    current: CurrentUser,
    Params(query): Params<Query>,
) -> ApiResult<Response> {
    let category = optional_id(&query, "category_id")?;
    let q = query
        .get("q")
        .map(|q| text(q, 0, 100))
        .transpose()?
        .filter(|q| !q.is_empty());
    let status = query.get("status").map(|s| one_of(s, &STATUSES)).transpose()?;
    ok(state
        .support()
        .menu
        .items(&current.actor(), category, q.as_deref(), status.as_deref())?)
}

async fn create(
    State(state): State<AppState>,
    current: CurrentUser,
    Body(body): Body<ItemPatch>,
) -> ApiResult<Response> {
    created(state.support().menu.create_item(&current.actor(), &body)?)
}

async fn show(State(state): State<AppState>, current: CurrentUser, Path(item): Path<String>) -> ApiResult<Response> {
    ok(state.support().menu.item(&current.actor(), id(&item)?)?)
}

async fn update(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(item): Path<String>,
    Body(body): Body<ItemPatch>,
) -> ApiResult<Response> {
    ok(state.support().menu.update_item(&current.actor(), id(&item)?, &body)?)
}

async fn remove(State(state): State<AppState>, current: CurrentUser, Path(item): Path<String>) -> ApiResult<Response> {
    state.support().menu.delete_item(&current.actor(), id(&item)?)?;
    done()
}

async fn duplicate(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(item): Path<String>,
) -> ApiResult<Response> {
    created(state.support().menu.duplicate_item(&current.actor(), id(&item)?)?)
}

#[derive(Deserialize)]
struct Order {
    category_id: i64,
    ids: Vec<i64>,
}

async fn reorder(State(state): State<AppState>, current: CurrentUser, Body(body): Body<Order>) -> ApiResult<Response> {
    let order = ids(&body.ids, 1, 1000)?;
    let category = id(&body.category_id.to_string())?;
    ok(state.support().menu.reorder_items(&current.actor(), category, &order)?)
}

#[derive(Deserialize)]
struct Status {
    ids: Vec<i64>,
    status: String,
}

async fn status(State(state): State<AppState>, current: CurrentUser, Body(body): Body<Status>) -> ApiResult<Response> {
    let items = ids(&body.ids, 1, 1000)?;
    let status = one_of(&body.status, &STATUSES)?;
    ok(state
        .support()
        .menu
        .set_items_status(&current.actor(), &items, &status)?)
}

async fn groups(State(state): State<AppState>, current: CurrentUser) -> ApiResult<Response> {
    ok(state.support().menu.groups(&current.actor())?)
}

async fn create_group(
    State(state): State<AppState>,
    current: CurrentUser,
    Body(body): Body<GroupPatch>,
) -> ApiResult<Response> {
    created(state.support().menu.create_group(&current.actor(), &body)?)
}

async fn show_group(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(group): Path<String>,
) -> ApiResult<Response> {
    ok(state.support().menu.group(&current.actor(), id(&group)?)?)
}

async fn update_group(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(group): Path<String>,
    Body(body): Body<GroupPatch>,
) -> ApiResult<Response> {
    ok(state
        .support()
        .menu
        .update_group(&current.actor(), id(&group)?, &body)?)
}

async fn delete_group(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(group): Path<String>,
) -> ApiResult<Response> {
    state.support().menu.delete_group(&current.actor(), id(&group)?)?;
    done()
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/catalog/items", get(list).post(create))
        .route("/catalog/items/reorder", post(reorder))
        .route("/catalog/items/status", post(status))
        .route("/catalog/items/{id}", get(show).patch(update).delete(remove))
        .route("/catalog/items/{id}/duplicate", post(duplicate))
        .route("/catalog/groups", get(groups).post(create_group))
        .route(
            "/catalog/groups/{id}",
            get(show_group).patch(update_group).delete(delete_group),
        )
}
