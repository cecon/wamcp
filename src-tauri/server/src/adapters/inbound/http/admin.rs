//! Desktop-only API on the local admin listener (admin token): sessions, history, MCP tokens,
//! ChatGPT links and audit.
use super::error::{created, done, error_body, ok, ApiError, ApiResult};
use super::input::{check, int_param, one_of, text, Body, Query};
use super::state::AppState;
use crate::application::ports::HistoryPage;
use crate::domain::events::JID;
use axum::extract::{Path, Query as Params, Request, State};
use axum::http::StatusCode;
use axum::middleware::Next;
use axum::response::Response;
use axum::routing::{delete, get, post};
use axum::Router;
use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Deserialize)]
struct Named {
    name: String,
}

async fn status(State(state): State<AppState>) -> ApiResult<Response> {
    let sessions = state.sessions.sessions()?.len();
    ok(json!({ "publicUrl": state.public_url, "service": "ready", "sessions": sessions }))
}

async fn sessions(State(state): State<AppState>) -> ApiResult<Response> {
    ok(state.sessions.sessions()?)
}

async fn create_session(State(state): State<AppState>, Body(body): Body<Named>) -> ApiResult<Response> {
    created(state.sessions.create_session(&text(&body.name, 1, 80)?)?)
}

/// Every `/api/sessions/{id}/…` route answers 404 for unknown sessions.
async fn known_session(State(state): State<AppState>, Path(params): Path<Vec<(String, String)>>, request: Request, next: Next) -> Response {
    let id = params.iter().find(|(k, _)| k == "id").map(|(_, v)| v.as_str()).unwrap_or_default();
    match state.sessions.session(id) {
        Ok(Some(_)) => next.run(request).await,
        _ => error_body(StatusCode::NOT_FOUND, "Sessão não encontrada"),
    }
}

async fn session(State(state): State<AppState>, Path(id): Path<String>) -> ApiResult<Response> {
    let mut value = serde_json::to_value(state.sessions.session(&id)?)?;
    let detail = serde_json::to_value(state.sessions.detail(&id)?)?;
    if let (Some(object), Value::Object(extra)) = (value.as_object_mut(), detail) {
        object.extend(extra);
        object.insert("mcpUrl".into(), json!(format!("{}/mcp/{id}", state.public_url)));
    }
    ok(value)
}

async fn connect(State(state): State<AppState>, Path(id): Path<String>) -> ApiResult<Response> {
    state.sessions.connect(&id).await?;
    done()
}

async fn disconnect(State(state): State<AppState>, Path(id): Path<String>) -> ApiResult<Response> {
    state.sessions.stop(&id, false).await?;
    done()
}

async fn logout(State(state): State<AppState>, Path(id): Path<String>) -> ApiResult<Response> {
    state.sessions.stop(&id, true).await?;
    done()
}

async fn chats(State(state): State<AppState>, Path(id): Path<String>, Params(query): Params<Query>) -> ApiResult<Response> {
    ok(state.sessions.chats(&id, query.get("q").map_or("", String::as_str))?)
}

async fn messages(State(state): State<AppState>, Path(id): Path<String>, Params(query): Params<Query>) -> ApiResult<Response> {
    let jid = query.get("jid").ok_or(ApiError::Invalid)?;
    check(JID.is_match(jid))?;
    let before = match query.get("before") {
        None => None,
        Some(v) => Some(v.parse::<f64>().ok().filter(|b| *b > 0.0).ok_or(ApiError::Invalid)?),
    };
    let before_id = query.get("beforeId").cloned();
    check(before_id.as_ref().is_none_or(|b| b.chars().count() <= 200))?;
    let page = HistoryPage { before, before_id, limit: int_param(&query, "limit", 100, 1, 200)? };
    ok(state.sessions.messages(&id, jid, &page)?)
}

async fn search(State(state): State<AppState>, Path(id): Path<String>, Params(query): Params<Query>) -> ApiResult<Response> {
    let q = query.get("q").ok_or(ApiError::Invalid)?;
    check((1..=200).contains(&q.chars().count()))?;
    ok(state.sessions.search(&id, q, 100)?)
}

async fn tokens(State(state): State<AppState>, Path(id): Path<String>) -> ApiResult<Response> {
    ok(state.sessions.tokens(&id)?)
}

#[derive(Deserialize)]
struct NewToken {
    name: String,
    scope: String,
    days: Option<i64>,
}

async fn issue_token(State(state): State<AppState>, Path(id): Path<String>, Body(body): Body<NewToken>) -> ApiResult<Response> {
    let (name, scope) = (text(&body.name, 1, 80)?, one_of(&body.scope, &["read", "read_write"])?);
    let days = body.days.unwrap_or(90);
    check((1..=365).contains(&days))?;
    created(state.sessions.issue_token(&id, &name, &scope, days)?)
}

async fn revoke(State(state): State<AppState>, Path((id, token)): Path<(String, String)>) -> ApiResult<Response> {
    state.sessions.revoke(&id, &token)?;
    done()
}

async fn audit(State(state): State<AppState>, Path(id): Path<String>) -> ApiResult<Response> {
    ok(state.sessions.audit(&id)?)
}

#[derive(Deserialize)]
struct Link {
    scope: String,
}

async fn chatgpt_link(State(state): State<AppState>, Path(id): Path<String>, Body(body): Body<Link>) -> ApiResult<Response> {
    let scope = one_of(&body.scope, &["read", "read_write"])?;
    let oauth = state.oauth.as_ref().ok_or(ApiError::Invalid)?;
    let link = oauth.create_link(&id, &scope).map_err(|e| ApiError::from(crate::domain::error::HelpdeskError::new(e.message)))?;
    ok(link)
}

async fn chatgpt(State(state): State<AppState>, Path(id): Path<String>) -> ApiResult<Response> {
    ok(state.oauth.as_ref().map(|o| o.connections(&id)).unwrap_or_default())
}

async fn chatgpt_disconnect(State(state): State<AppState>, Path((id, grant)): Path<(String, String)>) -> ApiResult<Response> {
    if let Some(oauth) = &state.oauth {
        oauth.disconnect(&id, &grant).map_err(|e| ApiError::from(crate::domain::error::HelpdeskError::new(e.message)))?;
    }
    done()
}

pub fn routes(state: AppState) -> Router<AppState> {
    let session = Router::new()
        .route("/api/sessions/{id}", get(session))
        .route("/api/sessions/{id}/connect", post(connect))
        .route("/api/sessions/{id}/disconnect", post(disconnect))
        .route("/api/sessions/{id}/logout", post(logout))
        .route("/api/sessions/{id}/chats", get(chats))
        .route("/api/sessions/{id}/messages", get(messages))
        .route("/api/sessions/{id}/search", get(search))
        .route("/api/sessions/{id}/tokens", get(tokens).post(issue_token))
        .route("/api/sessions/{id}/tokens/{token}", delete(revoke))
        .route("/api/sessions/{id}/audit", get(audit))
        .route("/api/sessions/{id}/chatgpt/link", post(chatgpt_link))
        .route("/api/sessions/{id}/chatgpt", get(chatgpt))
        .route("/api/sessions/{id}/chatgpt/{grant}", delete(chatgpt_disconnect))
        .route_layer(axum::middleware::from_fn_with_state(state, known_session));
    Router::new()
        .route("/api/status", get(status))
        .route("/api/sessions", get(sessions).post(create_session))
        .merge(session)
}
