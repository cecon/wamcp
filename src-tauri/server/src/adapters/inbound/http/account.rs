//! The account (name, language, auto-resolve) and the global search.
use super::auth::CurrentUser;
use super::error::{ok, ApiResult};
use super::input::{check, nullable_text, one_of, optional_text, text, Body, Query};
use super::state::AppState;
use crate::application::account_settings::{AccountChanges, LOCALES};
use crate::application::search::SEARCH_TYPES;
use axum::extract::{Query as Params, State};
use axum::response::Response;
use axum::routing::get;
use axum::Router;
use serde::Deserialize;

async fn show(State(state): State<AppState>, _user: CurrentUser) -> ApiResult<Response> {
    ok(state.support().helpdesk.account()?)
}

#[derive(Deserialize)]
struct Changes {
    name: Option<String>,
    locale: Option<String>,
    #[serde(default, deserialize_with = "crate::domain::model::nullable")]
    auto_resolve_duration: Option<Option<i64>>,
    #[serde(default, deserialize_with = "crate::domain::model::nullable")]
    auto_resolve_message: Option<Option<String>>,
}

async fn update(State(state): State<AppState>, current: CurrentUser, Body(body): Body<Changes>) -> ApiResult<Response> {
    check(
        body.auto_resolve_duration
            .flatten()
            .is_none_or(|d| (1..=999).contains(&d)),
    )?;
    let changes = AccountChanges {
        name: optional_text(body.name.as_deref(), 1, 120)?,
        locale: body.locale.as_deref().map(|l| one_of(l, &LOCALES)).transpose()?,
        auto_resolve_duration: body.auto_resolve_duration,
        auto_resolve_message: nullable_text(body.auto_resolve_message, 1000)?,
    };
    ok(state.support().helpdesk.update_account(&current.actor(), &changes)?)
}

async fn search(
    State(state): State<AppState>,
    current: CurrentUser,
    Params(query): Params<Query>,
) -> ApiResult<Response> {
    let q = text(query.get("q").map_or("", String::as_str), 0, 100)?;
    let kind = one_of(query.get("type").map_or("all", String::as_str), &SEARCH_TYPES)?;
    ok(state.support().helpdesk.search(&current.actor(), &q, &kind)?)
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/account", get(show).patch(update))
        .route("/search", get(search))
}
