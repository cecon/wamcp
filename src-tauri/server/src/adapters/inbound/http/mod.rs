//! HTTP inbound adapter: one listener for the web app, the API, MCP and OAuth — used by the desktop
//! window, the local network and the tunnel alike.
mod account;
mod accounts;
mod admin;
mod agent_bots;
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
mod menu;
mod menu_imports;
mod menu_items;
mod message_actions;
mod messages;
mod notifications;
pub mod rate_limit;
mod reports;
mod roles;
mod security;
mod sla;
pub mod state;
mod teams;
mod web_app;

use axum::extract::DefaultBodyLimit;
use axum::http::StatusCode;
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
        .merge(menu::routes())
        .merge(notifications::routes())
        .merge(automation::routes())
        .merge(macros::routes())
        .merge(security::routes())
        .merge(reports::routes())
        .merge(sla::routes())
        .merge(agent_bots::routes())
        .merge(roles::routes())
        .merge(admin::routes(state.clone()))
        .layer(axum::middleware::from_fn_with_state(state.clone(), audit::record))
        .layer(axum::middleware::from_fn_with_state(state.clone(), auth::same_origin))
}

/// The only listener: health, MCP, OAuth, first-run setup, helpdesk API and the web app.
pub fn public_router(state: AppState) -> Router {
    let mut router = Router::new()
        .route("/healthz", get(healthz))
        .route("/mcp/{id}", any(super::mcp::endpoint));
    if state.oauth.is_some() {
        router = router.merge(super::oauth::routes());
    }
    if state.support.is_some() {
        router = router
            .nest("/api/v1", helpdesk_api(&state))
            .merge(accounts::bootstrap_routes())
            .merge(web_app::routes());
    }
    router
        .fallback(not_found)
        .layer(DefaultBodyLimit::max(TRANSPORT_LIMIT))
        .with_state(state)
}
