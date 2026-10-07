//! HTTP inbound adapter: the local admin listener and the public listener (UI, API, MCP, OAuth).
mod account;
mod accounts;
mod admin;
mod audit;
pub mod auth;
mod automation;
mod catalog;
mod contact_book;
mod contacts;
mod conversation_tools;
mod conversations;
mod custom_data;
pub mod error;
pub mod input;
mod macros;
mod message_actions;
mod messages;
mod notifications;
pub mod rate_limit;
mod reports;
mod security;
mod sla;
pub mod state;
mod teams;
mod web_app;

use axum::extract::DefaultBodyLimit;
use axum::http::{HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{any, get};
use axum::{Json, Router};
use serde_json::json;
use state::AppState;

/// Requests up to this size reach the handlers, which answer bodies over 256 KiB with 413.
const TRANSPORT_LIMIT: usize = 1024 * 1024;

async fn healthz() -> Response {
    Json(json!({ "service": "wamcp", "ok": true })).into_response()
}

async fn not_found() -> Response {
    (StatusCode::NOT_FOUND, "Not Found").into_response()
}

/// `/api/v1`: same-origin guard, then the helpdesk routes (each authenticates the agent).
fn helpdesk_api(state: &AppState) -> Router<AppState> {
    Router::new()
        .merge(accounts::routes())
        .merge(account::routes())
        .merge(teams::routes())
        .merge(conversations::routes())
        .merge(contacts::routes())
        .merge(contact_book::routes())
        .merge(conversation_tools::routes())
        .merge(custom_data::routes())
        .merge(messages::routes())
        .merge(message_actions::routes())
        .merge(catalog::routes())
        .merge(notifications::routes())
        .merge(automation::routes())
        .merge(macros::routes())
        .merge(security::routes())
        .merge(reports::routes())
        .merge(sla::routes())
        .layer(axum::middleware::from_fn_with_state(state.clone(), audit::record))
        .layer(axum::middleware::from_fn_with_state(state.clone(), auth::same_origin))
}

/// The local admin listener (desktop app only, admin token).
pub fn admin_router(state: AppState) -> Router {
    let mut router = admin::routes(state.clone());
    if state.support.is_some() {
        router = router.merge(accounts::bootstrap_routes());
    }
    router
        .fallback(not_found)
        .layer(axum::middleware::from_fn_with_state(state.clone(), auth::admin_guard))
        .layer(DefaultBodyLimit::max(TRANSPORT_LIMIT))
        .layer(tower_http::set_header::SetResponseHeaderLayer::overriding(
            axum::http::header::X_CONTENT_TYPE_OPTIONS,
            HeaderValue::from_static("nosniff"),
        ))
        .with_state(state)
}

/// The public listener behind the tunnel: health, MCP, OAuth, helpdesk API and the agent UI.
pub fn public_router(state: AppState) -> Router {
    let mut router = Router::new()
        .route("/healthz", get(healthz))
        .route("/mcp/{id}", any(super::mcp::endpoint));
    if state.oauth.is_some() {
        router = router.merge(super::oauth::routes());
    }
    if state.support.is_some() {
        router = router.nest("/api/v1", helpdesk_api(&state)).merge(web_app::routes());
    }
    router
        .fallback(not_found)
        .layer(DefaultBodyLimit::max(TRANSPORT_LIMIT))
        .with_state(state)
}
