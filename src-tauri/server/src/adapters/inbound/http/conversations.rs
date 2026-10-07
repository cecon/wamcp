//! Conversations, messages and contacts under /api/v1 (requires an authenticated agent).
use super::auth::CurrentUser;
use super::error::{ok, ApiError, ApiResult};
use super::input::{check, email, id, int_param, nullable_text, one_of, optional_id, text, Body, Query};
use super::state::AppState;
use crate::application::ports::HistoryPage;
use crate::domain::helpdesk::{PRIORITIES, STATUSES};
use crate::domain::model::{ContactChanges, ConversationFilters};
use axum::extract::{Path, Query as Params, State};
use axum::response::Response;
use axum::routing::{get, post};
use axum::Router;
use serde::Deserialize;

fn filters(query: &Query) -> ApiResult<ConversationFilters> {
    let status = query.get("status").map_or("open", String::as_str);
    let mut statuses = STATUSES.to_vec();
    statuses.push("all");
    let assignee = query.get("assignee_type").map_or("all", String::as_str);
    let trimmed = |key: &str, max| query.get(key).map(|v| text(v, 0, max)).transpose();
    Ok(ConversationFilters {
        status: Some(one_of(status, &statuses)?),
        assignee_type: Some(one_of(assignee, &["me", "unassigned", "assigned", "all"])?),
        inbox_id: optional_id(query, "inbox_id")?,
        team_id: optional_id(query, "team_id")?,
        label: trimmed("label", 40)?,
        q: trimmed("q", 100)?,
        page: int_param(query, "page", 1, 1, 10_000)?,
        ..Default::default()
    })
}

async fn list(
    State(state): State<AppState>,
    current: CurrentUser,
    Params(query): Params<Query>,
) -> ApiResult<Response> {
    ok(state
        .support()
        .helpdesk
        .conversations(&current.actor(), filters(&query)?)?)
}

async fn meta(
    State(state): State<AppState>,
    current: CurrentUser,
    Params(query): Params<Query>,
) -> ApiResult<Response> {
    ok(state.support().helpdesk.meta(&current.actor(), filters(&query)?)?)
}

async fn show(State(state): State<AppState>, current: CurrentUser, Path(display): Path<String>) -> ApiResult<Response> {
    ok(state.support().helpdesk.conversation(&current.actor(), id(&display)?)?)
}

async fn messages(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(display): Path<String>,
    Params(query): Params<Query>,
) -> ApiResult<Response> {
    let before = optional_id(&query, "before")?;
    let limit = int_param(&query, "limit", 50, 1, 100)?;
    ok(state
        .support()
        .helpdesk
        .messages(&current.actor(), id(&display)?, before, limit)?)
}

async fn history(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(display): Path<String>,
    Params(query): Params<Query>,
) -> ApiResult<Response> {
    let before = match query.get("before") {
        None => None,
        Some(v) => Some(
            v.trim()
                .parse::<f64>()
                .ok()
                .filter(|b| *b > 0.0)
                .ok_or(ApiError::Invalid)?,
        ),
    };
    let before_id = query.get("before_id").cloned();
    check(before_id.as_ref().is_none_or(|b| b.chars().count() <= 200))?;
    let page = HistoryPage {
        before,
        before_id,
        limit: int_param(&query, "limit", 50, 1, 100)?,
    };
    ok(state
        .support()
        .helpdesk
        .history(&current.actor(), id(&display)?, &page)?)
}

#[derive(Deserialize)]
struct Status {
    status: String,
    snoozed_until: Option<i64>,
}

async fn toggle_status(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(display): Path<String>,
    Body(body): Body<Status>,
) -> ApiResult<Response> {
    let status = one_of(&body.status, &STATUSES)?;
    check(body.snoozed_until.is_none_or(|s| s > 0))?;
    let display = id(&display)?;
    ok(state
        .support()
        .helpdesk
        .toggle_status(&current.actor(), display, &status, body.snoozed_until)?)
}

#[derive(Deserialize)]
struct Assignment {
    #[serde(default, deserialize_with = "crate::domain::model::nullable")]
    assignee_id: Option<Option<i64>>,
    #[serde(default, deserialize_with = "crate::domain::model::nullable")]
    team_id: Option<Option<i64>>,
}

async fn assign(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(display): Path<String>,
    Body(body): Body<Assignment>,
) -> ApiResult<Response> {
    check(body.assignee_id.is_some() || body.team_id.is_some())?;
    let positive = |v: Option<Option<i64>>| v.flatten().is_none_or(|i| i > 0);
    check(positive(body.assignee_id) && positive(body.team_id))?;
    let display = id(&display)?;
    ok(state
        .support()
        .helpdesk
        .assign(&current.actor(), display, body.assignee_id, body.team_id)?)
}

#[derive(Deserialize)]
struct Priority {
    #[serde(deserialize_with = "crate::domain::model::nullable")]
    priority: Option<Option<String>>,
}

async fn priority(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(display): Path<String>,
    Body(body): Body<Priority>,
) -> ApiResult<Response> {
    let priority = body.priority.ok_or(ApiError::Invalid)?;
    if let Some(p) = &priority {
        one_of(p, &PRIORITIES)?;
    }
    let display = id(&display)?;
    ok(state
        .support()
        .helpdesk
        .set_priority(&current.actor(), display, priority.as_deref())?)
}

#[derive(Deserialize)]
struct Labels {
    labels: Vec<String>,
}

async fn labels(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(display): Path<String>,
    Body(body): Body<Labels>,
) -> ApiResult<Response> {
    check(body.labels.len() <= 50 && body.labels.iter().all(|l| l.chars().count() <= 40))?;
    ok(state
        .support()
        .helpdesk
        .set_labels(&current.actor(), id(&display)?, &body.labels)?)
}

async fn contacts(
    State(state): State<AppState>,
    _user: CurrentUser,
    Params(query): Params<Query>,
) -> ApiResult<Response> {
    let q = text(query.get("q").map_or("", String::as_str), 0, 100)?;
    let page = int_param(&query, "page", 1, 1, 10_000)?;
    ok(state.support().helpdesk.contacts(&q, page)?)
}

async fn contact(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(contact): Path<String>,
) -> ApiResult<Response> {
    ok(state.support().helpdesk.contact(&current.actor(), id(&contact)?)?)
}

async fn update_contact(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(contact): Path<String>,
    Body(body): Body<ContactChanges>,
) -> ApiResult<Response> {
    let address = match body.email.clone() {
        Some(Some(value)) => Some(Some(email(&value)?)),
        other => other,
    };
    let changes = ContactChanges {
        name: nullable_text(body.name.clone(), 120)?,
        email: address,
        identifier: nullable_text(body.identifier.clone(), 120)?,
        blocked: body.blocked,
        last_activity_at: None,
    };
    ok(state
        .support()
        .helpdesk
        .update_contact(&current.actor(), id(&contact)?, &changes)?)
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/conversations", get(list))
        .route("/conversations/meta", get(meta))
        .route("/conversations/{id}", get(show))
        .route("/conversations/{id}/messages", get(messages))
        .route("/conversations/{id}/history", get(history))
        .route("/conversations/{id}/toggle_status", post(toggle_status))
        .route("/conversations/{id}/assignments", post(assign))
        .route("/conversations/{id}/toggle_priority", post(priority))
        .route("/conversations/{id}/labels", post(labels))
        .route("/contacts", get(contacts))
        .route("/contacts/{id}", get(contact).patch(update_contact))
}
