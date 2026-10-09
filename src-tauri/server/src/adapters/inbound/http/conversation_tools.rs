//! Chat list and header tools: unread, mute, participants, transcript, deletion and bulk actions.
use super::auth::CurrentUser;
use super::error::{done, ok, ApiResult};
use super::input::{check, id, ids, one_of, Body};
use super::state::AppState;
use crate::application::bulk::BulkAction;
use crate::domain::helpdesk::{PRIORITIES, STATUSES};
use axum::extract::{Path, State};
use axum::http::header;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::Router;
use serde::Deserialize;

async fn unread(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(display): Path<String>,
) -> ApiResult<Response> {
    ok(state.support().helpdesk.mark_unread(&current.actor(), id(&display)?)?)
}

async fn mute(State(state): State<AppState>, current: CurrentUser, Path(display): Path<String>) -> ApiResult<Response> {
    ok(state
        .support()
        .helpdesk
        .set_muted(&current.actor(), id(&display)?, true)?)
}

async fn unmute(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(display): Path<String>,
) -> ApiResult<Response> {
    ok(state
        .support()
        .helpdesk
        .set_muted(&current.actor(), id(&display)?, false)?)
}

async fn participants(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(display): Path<String>,
) -> ApiResult<Response> {
    ok(state.support().helpdesk.participants(&current.actor(), id(&display)?)?)
}

#[derive(Deserialize)]
struct Participants {
    user_ids: Vec<i64>,
}

async fn set_participants(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(display): Path<String>,
    Body(body): Body<Participants>,
) -> ApiResult<Response> {
    let users = ids(&body.user_ids, 0, 50)?;
    ok(state
        .support()
        .helpdesk
        .set_participants(&current.actor(), id(&display)?, &users)?)
}

async fn transcript(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(display): Path<String>,
) -> ApiResult<Response> {
    let display = id(&display)?;
    let text = state.support().helpdesk.transcript(&current.actor(), display)?;
    let disposition = format!("attachment; filename=\"conversa-{display}.txt\"");
    let headers = [
        (header::CONTENT_TYPE, "text/plain; charset=utf-8".to_string()),
        (header::CONTENT_DISPOSITION, disposition),
    ];
    Ok((headers, text).into_response())
}

async fn remove(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(display): Path<String>,
) -> ApiResult<Response> {
    state
        .support()
        .helpdesk
        .delete_conversation(&current.actor(), id(&display)?)?;
    done()
}

#[derive(Deserialize, Default)]
struct Labels {
    #[serde(default)]
    add: Vec<String>,
    #[serde(default)]
    remove: Vec<String>,
}

#[derive(Deserialize, Default)]
struct Fields {
    status: Option<String>,
    snoozed_until: Option<i64>,
    #[serde(default, deserialize_with = "crate::domain::model::nullable")]
    assignee_id: Option<Option<i64>>,
    #[serde(default, deserialize_with = "crate::domain::model::nullable")]
    team_id: Option<Option<i64>>,
    #[serde(default, deserialize_with = "crate::domain::model::nullable")]
    priority: Option<Option<String>>,
}

#[derive(Deserialize)]
struct Bulk {
    ids: Vec<i64>,
    #[serde(default)]
    fields: Fields,
    #[serde(default)]
    labels: Labels,
}

async fn bulk(State(state): State<AppState>, current: CurrentUser, Body(body): Body<Bulk>) -> ApiResult<Response> {
    let fields = body.fields;
    if let Some(status) = &fields.status {
        one_of(status, &STATUSES)?;
    }
    if let Some(Some(priority)) = &fields.priority {
        one_of(priority, &PRIORITIES)?;
    }
    let labels = body.labels;
    check(labels.add.len() + labels.remove.len() <= 50)?;
    let action = BulkAction {
        ids: ids(&body.ids, 1, 100)?,
        status: fields.status,
        snoozed_until: fields.snoozed_until,
        assignee: fields.assignee_id,
        team: fields.team_id,
        priority: fields.priority,
        add_labels: labels.add,
        remove_labels: labels.remove,
    };
    ok(state.support().helpdesk.bulk(&current.actor(), &action)?)
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/conversations/{id}/unread", post(unread))
        .route("/conversations/{id}/mute", post(mute))
        .route("/conversations/{id}/unmute", post(unmute))
        .route(
            "/conversations/{id}/participants",
            get(participants).patch(set_participants),
        )
        .route("/conversations/{id}/transcript", get(transcript))
        .route("/conversations/{id}", axum::routing::delete(remove))
        .route("/bulk_actions", post(bulk))
}
