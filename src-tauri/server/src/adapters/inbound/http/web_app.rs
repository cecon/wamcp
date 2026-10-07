//! Serves the agent web app at /app on the public listener (the same port as the API and MCP).
use super::state::AppState;
use axum::body::Body;
use axum::extract::{Path, State};
use axum::http::{header, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Redirect, Response};
use axum::routing::get;
use axum::Router;
use std::path::{Component, PathBuf};

const CSP: &str = "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";

fn mime(path: &std::path::Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()).unwrap_or_default() {
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "html" => "text/html; charset=utf-8",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "ico" => "image/x-icon",
        "woff2" => "font/woff2",
        "woff" => "font/woff",
        "json" | "map" => "application/json",
        _ => "application/octet-stream",
    }
}

fn secured(mut response: Response) -> Response {
    let headers = response.headers_mut();
    headers.insert(header::CONTENT_SECURITY_POLICY, HeaderValue::from_static(CSP));
    headers.insert(header::X_CONTENT_TYPE_OPTIONS, HeaderValue::from_static("nosniff"));
    headers.insert(header::REFERRER_POLICY, HeaderValue::from_static("no-referrer"));
    response
}

fn file(path: PathBuf, cache: &'static str) -> Response {
    match std::fs::read(&path) {
        Ok(bytes) => Response::builder()
            .header(header::CONTENT_TYPE, mime(&path))
            .header(header::CACHE_CONTROL, cache)
            .body(Body::from(bytes))
            .unwrap_or_default(),
        Err(_) => StatusCode::NOT_FOUND.into_response(),
    }
}

async fn index(State(state): State<AppState>) -> Response {
    // Resolved per request so a UI rebuilt while the service runs is picked up without a restart.
    let response = match (state.support().web_dir)() {
        Some(dir) => file(dir.join("agent.html"), "no-cache"),
        None => (StatusCode::SERVICE_UNAVAILABLE, "Interface web não foi gerada. Execute npm run build.").into_response(),
    };
    secured(response)
}

async fn asset(State(state): State<AppState>, Path(path): Path<String>) -> Response {
    let relative = PathBuf::from(&path);
    let safe = relative.components().all(|c| matches!(c, Component::Normal(_)));
    let response = match (state.support().web_dir)() {
        Some(dir) if safe => file(dir.join("assets").join(relative), "public, max-age=31536000, immutable"),
        _ => StatusCode::NOT_FOUND.into_response(),
    };
    secured(response)
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/", get(|| async { Redirect::to("/app/") }))
        // The source page is agent.html (what Vite serves in dev); on the backend it lives at /app/.
        .route("/agent.html", get(|| async { Redirect::to("/app/") }))
        .route("/app", get(|| async { Redirect::to("/app/") }))
        .route("/app/", get(index))
        .route("/app/assets/{*path}", get(asset))
}
