//! Message actions from agents: reactions, deletion, retry, typing and read receipts.
use super::auth::CurrentUser;
use super::error::{ok, ApiResult};
use super::input::{check, id, Body};
use super::state::AppState;
use axum::extract::{Path, State};
use axum::response::Response;
use axum::routing::{delete, post};
use axum::Router;
use serde::Deserialize;
use serde_json::json;

#[derive(Deserialize)]
struct Reaction {
    #[serde(default)]
    emoji: String,
}

async fn react(
    State(state): State<AppState>,
    current: CurrentUser,
    Path((display, message)): Path<(String, String)>,
    Body(body): Body<Reaction>,
) -> ApiResult<Response> {
    let (display, message) = (id(&display)?, id(&message)?);
    let helpdesk = &state.support().helpdesk;
    ok(helpdesk
        .react(&current.actor(), display, message, body.emoji.trim())
        .await?)
}

async fn remove(
    State(state): State<AppState>,
    current: CurrentUser,
    Path((display, message)): Path<(String, String)>,
) -> ApiResult<Response> {
    let (display, message) = (id(&display)?, id(&message)?);
    ok(state
        .support()
        .helpdesk
        .delete_message(&current.actor(), display, message)
        .await?)
}

async fn retry(
    State(state): State<AppState>,
    current: CurrentUser,
    Path((display, message)): Path<(String, String)>,
) -> ApiResult<Response> {
    let (display, message) = (id(&display)?, id(&message)?);
    ok(state
        .support()
        .helpdesk
        .retry(&current.actor(), display, message)
        .await?)
}

#[derive(Deserialize)]
struct TypingStatus {
    typing_status: String,
    #[serde(default)]
    is_private: bool,
}

async fn typing(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(display): Path<String>,
    Body(body): Body<TypingStatus>,
) -> ApiResult<Response> {
    check(["on", "off", "recording"].contains(&body.typing_status.as_str()))?;
    let display = id(&display)?;
    let helpdesk = &state.support().helpdesk;
    helpdesk
        .agent_typing(&current.actor(), display, &body.typing_status, body.is_private)
        .await?;
    ok(json!({ "ok": true }))
}

/// Marks the conversation as seen and sends read receipts (blue ticks) for the new messages.
async fn seen(State(state): State<AppState>, current: CurrentUser, Path(display): Path<String>) -> ApiResult<Response> {
    let display = id(&display)?;
    let (helpdesk, actor) = (state.support().helpdesk.clone(), current.actor());
    let before = helpdesk.conversation(&actor, display)?.agent_last_seen_at;
    let updated = helpdesk.mark_seen(&actor, display)?;
    tokio::spawn(async move {
        let _ = helpdesk.send_read_receipts(&actor, display, before).await;
    });
    ok(updated)
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/conversations/{id}/messages/{message}", delete(remove))
        .route("/conversations/{id}/messages/{message}/reactions", post(react))
        .route("/conversations/{id}/messages/{message}/retry", post(retry))
        .route("/conversations/{id}/toggle_typing_status", post(typing))
        .route("/conversations/{id}/update_last_seen", post(seen))
}
