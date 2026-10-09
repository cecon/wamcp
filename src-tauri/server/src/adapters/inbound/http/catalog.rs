//! Labels, canned responses, notifications and the realtime stream under /api/v1.
use super::auth::CurrentUser;
use super::error::{created, done, ok, ApiResult};
use super::input::{check, id, nullable_text, raw, text, Body, Query};
use super::state::AppState;
use crate::domain::model::LabelFields;
use axum::body::{Body as Stream, Bytes};
use axum::extract::{Path, Query as Params, State};
use axum::http::header;
use axum::response::Response;
use axum::routing::{get, patch, post};
use axum::Router;
use regex::Regex;
use serde::Deserialize;
use std::convert::Infallible;
use std::sync::LazyLock;
use std::time::Duration;

static COLOR: LazyLock<Regex> = LazyLock::new(|| Regex::new("^#[0-9a-fA-F]{6}$").expect("valid regex"));

fn label_fields(body: LabelFields, partial: bool) -> ApiResult<LabelFields> {
    check(partial || body.title.is_some())?;
    check(body.color.as_deref().is_none_or(|c| COLOR.is_match(c)))?;
    Ok(LabelFields {
        title: body.title.as_deref().map(|t| text(t, 1, 40)).transpose()?,
        description: nullable_text(body.description, 200)?,
        ..body
    })
}

async fn labels(State(state): State<AppState>, _user: CurrentUser) -> ApiResult<Response> {
    ok(state.support().catalog.labels()?)
}

async fn create_label(
    State(state): State<AppState>,
    current: CurrentUser,
    Body(body): Body<LabelFields>,
) -> ApiResult<Response> {
    created(
        state
            .support()
            .catalog
            .create_label(&current.actor(), &label_fields(body, false)?)?,
    )
}

async fn update_label(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(label): Path<String>,
    Body(body): Body<LabelFields>,
) -> ApiResult<Response> {
    let id = id(&label)?;
    ok(state
        .support()
        .catalog
        .update_label(&current.actor(), id, &label_fields(body, true)?)?)
}

async fn delete_label(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(label): Path<String>,
) -> ApiResult<Response> {
    state.support().catalog.delete_label(&current.actor(), id(&label)?)?;
    done()
}

#[derive(Deserialize)]
struct Canned {
    short_code: Option<String>,
    content: Option<String>,
}

async fn canned(
    State(state): State<AppState>,
    _user: CurrentUser,
    Params(query): Params<Query>,
) -> ApiResult<Response> {
    let q = raw(query.get("q").map_or("", String::as_str), 0, 100)?;
    ok(state.support().catalog.canned_responses(&q)?)
}

async fn create_canned(
    State(state): State<AppState>,
    _user: CurrentUser,
    Body(body): Body<Canned>,
) -> ApiResult<Response> {
    let code = text(body.short_code.as_deref().unwrap_or_default(), 1, 40)?;
    let content = text(body.content.as_deref().unwrap_or_default(), 1, 4096)?;
    created(state.support().catalog.create_canned(&code, &content)?)
}

async fn update_canned(
    State(state): State<AppState>,
    _user: CurrentUser,
    Path(canned): Path<String>,
    Body(body): Body<Canned>,
) -> ApiResult<Response> {
    let code = body.short_code.as_deref().map(|c| text(c, 1, 40)).transpose()?;
    let content = body.content.as_deref().map(|c| text(c, 1, 4096)).transpose()?;
    let id = id(&canned)?;
    ok(state
        .support()
        .catalog
        .update_canned(id, code.as_deref(), content.as_deref())?)
}

async fn delete_canned(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(canned): Path<String>,
) -> ApiResult<Response> {
    state.support().catalog.delete_canned(&current.actor(), id(&canned)?)?;
    done()
}

async fn notifications(State(state): State<AppState>, current: CurrentUser) -> ApiResult<Response> {
    ok(state.support().notifications.list(&current.user)?)
}

async fn unread(State(state): State<AppState>, current: CurrentUser) -> ApiResult<Response> {
    ok(state.support().notifications.unread_count(&current.user)?)
}

async fn read_all(State(state): State<AppState>, current: CurrentUser) -> ApiResult<Response> {
    ok(state.support().notifications.read_all(&current.user)?)
}

async fn read(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(notification): Path<String>,
) -> ApiResult<Response> {
    ok(state.support().notifications.read(&current.user, id(&notification)?)?)
}

/// Server-Sent Events: works through the Cloudflare tunnel without WebSocket upgrades.
async fn events(State(state): State<AppState>, current: CurrentUser) -> Response {
    let support = state.support().clone();
    let (sender, receiver) = tokio::sync::mpsc::unbounded_channel::<Bytes>();
    let _ = sender.send(Bytes::from_static(b"retry: 3000\n\n"));
    let (notifications, user, events) = (support.notifications.clone(), current.user.clone(), sender.clone());
    let listener = support.bus.subscribe(move |envelope| {
        if notifications.visible_to(&user, envelope) {
            let data = serde_json::json!({ "data": envelope.data, "performer": envelope.performer });
            let _ = events.send(Bytes::from(format!("event: {}\ndata: {data}\n\n", envelope.event)));
        }
    });
    let (bus, accounts, user_id) = (support.bus.clone(), support.accounts.clone(), current.user.id);
    tokio::spawn(async move {
        // Keep proxies from closing idle streams, and end streams whose user lost access.
        let mut ticker = tokio::time::interval(Duration::from_secs(25));
        ticker.tick().await;
        loop {
            tokio::select! {
                _ = ticker.tick() => {
                    if !accounts.is_active(user_id) || sender.send(Bytes::from_static(b": ping\n\n")).is_err() {
                        break;
                    }
                }
                _ = sender.closed() => break,
            }
        }
        bus.unsubscribe(listener);
    });
    let stream = tokio_stream::wrappers::UnboundedReceiverStream::new(receiver);
    let body = Stream::from_stream(futures::StreamExt::map(stream, Ok::<_, Infallible>));
    Response::builder()
        .header(header::CONTENT_TYPE, "text/event-stream; charset=utf-8")
        .header(header::CACHE_CONTROL, "no-cache, no-transform")
        .header("X-Accel-Buffering", "no")
        .body(body)
        .unwrap_or_default()
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/labels", get(labels).post(create_label))
        .route("/labels/{id}", patch(update_label).delete(delete_label))
        .route("/canned_responses", get(canned).post(create_canned))
        .route("/canned_responses/{id}", patch(update_canned).delete(delete_canned))
        .route("/notifications", get(notifications))
        .route("/notifications/unread_count", get(unread))
        .route("/notifications/read_all", post(read_all))
        .route("/notifications/{id}", patch(read))
        .route("/events", get(events))
}
