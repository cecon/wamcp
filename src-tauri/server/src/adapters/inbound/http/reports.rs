//! Reports v2: time series, summaries, breakdowns, CSAT metrics/export and bot metrics (admins).
use super::auth::CurrentUser;
use super::error::{ok, ApiResult};
use super::input::{one_of, optional_id, text, Query};
use super::state::AppState;
use crate::application::reports_v2::ReportQuery;
use crate::domain::reports::{DIMENSIONS, GROUPS, METRICS};
use axum::extract::{Path, Query as Params, State};
use axum::http::header;
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::Router;

fn report_query(query: &Query) -> ApiResult<ReportQuery> {
    Ok(ReportQuery {
        metric: query.get("metric").map(|m| one_of(m, &METRICS)).transpose()?,
        dimension: one_of(query.get("type").map_or("account", String::as_str), &DIMENSIONS)?,
        id: optional_id(query, "id")?,
        label: query.get("label").map(|l| text(l, 1, 40)).transpose()?,
        since: optional_id(query, "since")?,
        until: optional_id(query, "until")?,
        group_by: one_of(query.get("group_by").map_or("day", String::as_str), &GROUPS)?,
    })
}

async fn series(
    State(state): State<AppState>,
    current: CurrentUser,
    Params(query): Params<Query>,
) -> ApiResult<Response> {
    let q = report_query(&query)?;
    if q.metric.is_none() {
        return Err(super::error::ApiError::Invalid);
    }
    ok(state.support().reports.timeseries(&current.actor(), &q)?)
}

async fn summary(
    State(state): State<AppState>,
    current: CurrentUser,
    Params(query): Params<Query>,
) -> ApiResult<Response> {
    ok(state
        .support()
        .reports
        .summary_v2(&current.actor(), &report_query(&query)?)?)
}

async fn breakdown(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(kind): Path<String>,
    Params(query): Params<Query>,
) -> ApiResult<Response> {
    let kind = one_of(&kind, &["inbox", "agent", "team", "label"])?;
    ok(state
        .support()
        .reports
        .breakdown(&current.actor(), &kind, &report_query(&query)?)?)
}

async fn csat_metrics(
    State(state): State<AppState>,
    current: CurrentUser,
    Params(query): Params<Query>,
) -> ApiResult<Response> {
    ok(state
        .support()
        .reports
        .csat_metrics(&current.actor(), &report_query(&query)?)?)
}

async fn csat_download(
    State(state): State<AppState>,
    current: CurrentUser,
    Params(query): Params<Query>,
) -> ApiResult<Response> {
    let csv = state
        .support()
        .reports
        .csat_csv(&current.actor(), &report_query(&query)?)?;
    let headers = [
        (header::CONTENT_TYPE, "text/csv; charset=utf-8"),
        (header::CONTENT_DISPOSITION, "attachment; filename=\"csat.csv\""),
    ];
    Ok((headers, csv).into_response())
}

async fn bots(
    State(state): State<AppState>,
    current: CurrentUser,
    Params(query): Params<Query>,
) -> ApiResult<Response> {
    ok(state
        .support()
        .reports
        .bot_summary(&current.actor(), &report_query(&query)?)?)
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/reports", get(series))
        .route("/reports/summary_v2", get(summary))
        .route("/reports/breakdown/{kind}", get(breakdown))
        .route("/reports/bots", get(bots))
        .route("/csat_survey_responses/metrics", get(csat_metrics))
        .route("/csat_survey_responses/download", get(csat_download))
}
