//! Teams and inboxes under /api/v1.
use super::auth::CurrentUser;
use super::error::{created, done, ok, ApiResult};
use super::input::{check, id, ids, nullable_text, text, Body};
use super::state::AppState;
use crate::domain::model::{DaySchedule, InboxChanges, TeamFields};
use axum::extract::{Path, State};
use axum::response::Response;
use axum::routing::get;
use axum::Router;
use serde::Deserialize;

#[derive(Deserialize)]
struct Members {
    user_ids: Vec<i64>,
}

fn team_fields(fields: TeamFields, partial: bool) -> ApiResult<TeamFields> {
    if !partial {
        check(fields.name.is_some())?;
    }
    Ok(TeamFields {
        name: fields.name.as_deref().map(|n| text(n, 1, 80)).transpose()?,
        description: nullable_text(fields.description, 500)?,
        allow_auto_assign: fields.allow_auto_assign,
    })
}

async fn teams(State(state): State<AppState>, _user: CurrentUser) -> ApiResult<Response> {
    ok(state.support().accounts.teams()?)
}

async fn create_team(
    State(state): State<AppState>,
    current: CurrentUser,
    Body(body): Body<TeamFields>,
) -> ApiResult<Response> {
    created(
        state
            .support()
            .accounts
            .create_team(&current.actor(), &team_fields(body, false)?)?,
    )
}

async fn update_team(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(team): Path<String>,
    Body(body): Body<TeamFields>,
) -> ApiResult<Response> {
    let id = id(&team)?;
    ok(state
        .support()
        .accounts
        .update_team(&current.actor(), id, &team_fields(body, true)?)?)
}

async fn delete_team(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(team): Path<String>,
) -> ApiResult<Response> {
    state.support().accounts.delete_team(&current.actor(), id(&team)?)?;
    done()
}

async fn team_members(
    State(state): State<AppState>,
    _user: CurrentUser,
    Path(team): Path<String>,
) -> ApiResult<Response> {
    ok(state.support().accounts.team_members(id(&team)?)?)
}

async fn add_team_members(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(team): Path<String>,
    Body(body): Body<Members>,
) -> ApiResult<Response> {
    let (team, users) = (id(&team)?, ids(&body.user_ids, 1, 200)?);
    ok(state
        .support()
        .accounts
        .change_team_members(&current.actor(), team, &users, true)?)
}

async fn remove_team_members(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(team): Path<String>,
    Body(body): Body<Members>,
) -> ApiResult<Response> {
    let (team, users) = (id(&team)?, ids(&body.user_ids, 1, 200)?);
    ok(state
        .support()
        .accounts
        .change_team_members(&current.actor(), team, &users, false)?)
}

async fn inboxes(State(state): State<AppState>, current: CurrentUser) -> ApiResult<Response> {
    ok(state.support().accounts.inboxes(&current.actor())?)
}

async fn inbox(State(state): State<AppState>, current: CurrentUser, Path(inbox): Path<String>) -> ApiResult<Response> {
    ok(state.support().accounts.inbox(&current.actor(), id(&inbox)?)?)
}

async fn update_inbox(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(inbox): Path<String>,
    Body(body): Body<InboxChanges>,
) -> ApiResult<Response> {
    if let Some(Some(greeting)) = &body.greeting_message {
        check(greeting.chars().count() <= 1000)?;
    }
    if let Some(zone) = &body.timezone {
        check(zone.chars().count() <= 64)?;
    }
    check(
        body.max_assignment_limit
            .flatten()
            .is_none_or(|l| (1..=1000).contains(&l)),
    )?;
    let changes = InboxChanges {
        name: body.name.as_deref().map(|n| text(n, 1, 80)).transpose()?,
        out_of_office_message: nullable_text(body.out_of_office_message.clone(), 1000)?,
        csat_survey_message: nullable_text(body.csat_survey_message.clone(), 1000)?,
        ..body
    };
    let id = id(&inbox)?;
    ok(state.support().accounts.update_inbox(&current.actor(), id, &changes)?)
}

#[derive(Deserialize)]
struct Schedule {
    working_hours: Vec<DaySchedule>,
}

async fn working_hours(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(inbox): Path<String>,
) -> ApiResult<Response> {
    ok(state.support().accounts.working_hours(&current.actor(), id(&inbox)?)?)
}

async fn set_working_hours(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(inbox): Path<String>,
    Body(body): Body<Schedule>,
) -> ApiResult<Response> {
    let days = body.working_hours;
    let minutes = |m: i64| (0..=1440).contains(&m);
    check(days.len() <= 7)?;
    check(
        days.iter()
            .all(|d| (0..=6).contains(&d.day_of_week) && minutes(d.open_minutes) && minutes(d.close_minutes)),
    )?;
    ok(state
        .support()
        .accounts
        .set_working_hours(&current.actor(), id(&inbox)?, &days)?)
}

async fn inbox_members(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(inbox): Path<String>,
) -> ApiResult<Response> {
    ok(state.support().accounts.inbox_members(&current.actor(), id(&inbox)?)?)
}

async fn add_inbox_members(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(inbox): Path<String>,
    Body(body): Body<Members>,
) -> ApiResult<Response> {
    let (inbox, users) = (id(&inbox)?, ids(&body.user_ids, 1, 200)?);
    ok(state
        .support()
        .accounts
        .change_inbox_members(&current.actor(), inbox, &users, true)?)
}

async fn remove_inbox_members(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(inbox): Path<String>,
    Body(body): Body<Members>,
) -> ApiResult<Response> {
    let (inbox, users) = (id(&inbox)?, ids(&body.user_ids, 1, 200)?);
    ok(state
        .support()
        .accounts
        .change_inbox_members(&current.actor(), inbox, &users, false)?)
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/teams", get(teams).post(create_team))
        .route("/teams/{id}", axum::routing::patch(update_team).delete(delete_team))
        .route(
            "/teams/{id}/members",
            get(team_members).post(add_team_members).delete(remove_team_members),
        )
        .route("/inboxes", get(inboxes))
        .route("/inboxes/{id}", get(inbox).patch(update_inbox))
        .route("/inboxes/{id}/working_hours", get(working_hours).put(set_working_hours))
        .route(
            "/inboxes/{id}/members",
            get(inbox_members).post(add_inbox_members).delete(remove_inbox_members),
        )
}
