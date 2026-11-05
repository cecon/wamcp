//! The GitHub App: starting it (administrators), the page that hands the manifest to GitHub, the
//! address GitHub returns to with the App, and the App's webhook (signed with its secret).
use super::auth::CurrentUser;
use super::error::{ok, ApiResult};
use super::input::Body;
use super::state::AppState;
use axum::body::Bytes;
use axum::extract::{Query, State};
use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
use axum::response::{Html, IntoResponse, Redirect, Response};
use axum::routing::{get, post};
use axum::Router;
use serde::Deserialize;

#[derive(Deserialize)]
struct Start {
    owner: Option<String>,
}

async fn status(State(state): State<AppState>, current: CurrentUser) -> ApiResult<Response> {
    ok(state.support().helpdesk.github_app_status(&current.actor())?)
}

async fn remove(State(state): State<AppState>, current: CurrentUser) -> ApiResult<Response> {
    ok(state.support().helpdesk.remove_github_app(&current.actor())?)
}

async fn start(State(state): State<AppState>, current: CurrentUser, Body(body): Body<Start>) -> ApiResult<Response> {
    let started =
        state
            .support()
            .helpdesk
            .start_github_app(&current.actor(), body.owner.as_deref(), &state.public_url)?;
    ok(started)
}

#[derive(Deserialize)]
struct Back {
    state: Option<String>,
    code: Option<String>,
}

fn escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

const STYLE: &str = "body{font:16px system-ui;background:#f4f8f6;color:#163c32;margin:0;padding:32px}main{max-width:520px;margin:6vh auto;background:white;padding:32px;border-radius:16px}button{background:#07865f;color:white;border:0;border-radius:8px;padding:14px 24px;cursor:pointer;margin-top:12px}p{line-height:1.6}";

fn page(title: &str, body: &str, form_action: &str, status: StatusCode) -> Response {
    let html = format!(
        "<!doctype html><html lang=\"pt-BR\"><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>{title}</title><style>{STYLE}</style><main><h1>{title}</h1>{body}</main></html>"
    );
    let csp = format!(
        "default-src 'none'; style-src 'unsafe-inline'; form-action {form_action}; base-uri 'none'; frame-ancestors 'none'"
    );
    let mut response = (status, Html(html)).into_response();
    let headers = response.headers_mut();
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    headers.insert(header::REFERRER_POLICY, HeaderValue::from_static("no-referrer"));
    if let Ok(value) = HeaderValue::from_str(&csp) {
        headers.insert(header::CONTENT_SECURITY_POLICY, value);
    }
    response
}

fn failure(message: &str) -> Response {
    let body = format!(
        "<p>{}</p><p>Volte ao WA MCP e comece de novo em Configurações → Canais.</p>",
        escape(message)
    );
    page("GitHub App não criado", &body, "'none'", StatusCode::BAD_REQUEST)
}

/// Posts the manifest to GitHub (a click: no script runs on this page).
async fn new_app(State(state): State<AppState>, Query(back): Query<Back>) -> Response {
    let form = state
        .support()
        .helpdesk
        .github_app_form(back.state.as_deref().unwrap_or_default(), &state.public_url);
    match form {
        Ok((action, manifest)) => {
            let body = format!(
                "<p>O GitHub vai abrir com o App já preenchido: nome, permissões e webhook. Confira e confirme; depois escolha em quais repositórios instalar.</p><form method=\"post\" action=\"{}\"><input type=\"hidden\" name=\"manifest\" value=\"{}\"><button type=\"submit\">Continuar no GitHub</button></form>",
                escape(&action),
                escape(&manifest)
            );
            page(
                "Criar o GitHub App do agente",
                &body,
                "https://github.com",
                StatusCode::OK,
            )
        }
        Err(error) => failure(&error.to_string()),
    }
}

/// GitHub returns here with the App's code; the person goes on to install it.
async fn callback(State(state): State<AppState>, Query(back): Query<Back>) -> Response {
    let (Some(app_state), Some(code)) = (back.state, back.code) else {
        return failure("O GitHub não devolveu o App.");
    };
    match state.support().helpdesk.finish_github_app(&app_state, &code).await {
        Ok(install) => Redirect::to(&install).into_response(),
        Err(error) => failure(&error.to_string()),
    }
}

fn header<'a>(headers: &'a HeaderMap, name: &str) -> &'a str {
    headers.get(name).and_then(|v| v.to_str().ok()).unwrap_or_default()
}

async fn webhook(State(state): State<AppState>, headers: HeaderMap, body: Bytes) -> ApiResult<Response> {
    let event = header(&headers, "x-github-event");
    if event == "ping" {
        return Ok(StatusCode::NO_CONTENT.into_response());
    }
    state.support().helpdesk.receive_github_app(
        event,
        header(&headers, "x-github-delivery"),
        header(&headers, "x-hub-signature-256"),
        &body,
    )?;
    Ok(StatusCode::ACCEPTED.into_response())
}

/// Under `/api/v1` (session and same-origin checks).
pub fn routes() -> Router<AppState> {
    Router::new().route("/github_app", get(status).post(start).delete(remove))
}

/// Mounted outside `/api/v1`: the browser comes from GitHub, and GitHub posts the events.
pub fn public_routes() -> Router<AppState> {
    Router::new()
        .route("/api/github/app/new", get(new_app))
        .route("/api/github/app/callback", get(callback))
        .route("/api/github/app/webhook", post(webhook))
}
