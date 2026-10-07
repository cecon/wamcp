//! The authenticated MCP endpoint `/mcp/{session}`: Streamable HTTP with JSON responses, serving
//! the 2026-07-28 revision (per-request envelope) and 2025-era stateless traffic side by side.
mod args;
pub mod catalog;
mod dispatch;
pub mod envelope;
mod events;
pub mod tools;

use super::http::auth::bearer;
use super::http::input::BODY_LIMIT;
use super::http::rate_limit::{client_key, Peer};
use super::http::state::AppState;
use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::{header, HeaderMap, HeaderValue, Method, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use dispatch::Outcome;
use envelope::{envelope, is_modern, routing_headers, shape, Rejection};
use serde_json::{json, Value};
use tools::{challenge, Call};

fn json_response(status: u16, body: Value) -> Response {
    let status = StatusCode::from_u16(status).unwrap_or(StatusCode::OK);
    (status, Json(body)).into_response()
}

fn protocol_error(status: u16, code: i64, message: &str) -> Response {
    json_response(status, json!({ "jsonrpc": "2.0", "id": null, "error": { "code": code, "message": message } }))
}

fn reply(id: Value, outcome: Outcome) -> Response {
    match outcome {
        Outcome::Result(result) => json_response(200, json!({ "result": result, "jsonrpc": "2.0", "id": id })),
        Outcome::Error { status, code, message, data } => {
            let mut error = json!({ "code": code, "message": message });
            if let Some(data) = data {
                error["data"] = data;
            }
            json_response(status, json!({ "jsonrpc": "2.0", "id": id, "error": error }))
        }
    }
}

fn rejected(rejection: Rejection) -> Response {
    json_response(rejection.status, rejection.body())
}

async fn serve(call: &Call<'_>, body: &Value, headers: &HeaderMap) -> Response {
    if is_modern(body, headers) {
        if let Err(rejection) = shape(body).and_then(|_| envelope(body, headers).map(drop)).and_then(|_| routing_headers(body, headers)) {
            return rejected(rejection);
        }
        let Some(id) = body.get("id").cloned() else {
            return StatusCode::ACCEPTED.into_response();
        };
        let method = body["method"].as_str().unwrap_or_default();
        return reply(id, dispatch::modern(call, method, &body["params"]).await);
    }
    let messages = match body {
        Value::Array(items) => items.clone(),
        other => vec![other.clone()],
    };
    let mut responses = Vec::new();
    for message in &messages {
        if shape(message).is_err() {
            return protocol_error(400, -32600, "Invalid Request: the body is not a valid JSON-RPC message");
        }
        let Some(id) = message.get("id").cloned() else {
            continue;
        };
        let method = message["method"].as_str().unwrap_or_default();
        let params = message.get("params").cloned().unwrap_or(json!({}));
        responses.push(reply(id, dispatch::legacy(call, method, &params).await));
    }
    match (body.is_array(), responses.len()) {
        (_, 0) => StatusCode::ACCEPTED.into_response(),
        (false, _) => responses.remove(0),
        (true, _) => {
            let mut items = Vec::new();
            for response in responses {
                let bytes = axum::body::to_bytes(response.into_body(), BODY_LIMIT * 4).await.unwrap_or_default();
                items.push(serde_json::from_slice::<Value>(&bytes).unwrap_or(Value::Null));
            }
            json_response(200, Value::Array(items))
        }
    }
}

pub async fn endpoint(
    State(state): State<AppState>,
    Path(session): Path<String>,
    peer: Peer,
    method: Method,
    headers: HeaderMap,
    bytes: Bytes,
) -> Response {
    if let Some(limited) = state.limits.mcp.reject(&client_key(&headers, peer.0)) {
        return limited;
    }
    let body: Option<Value> = if method == Method::POST && !bytes.is_empty() {
        if bytes.len() > BODY_LIMIT {
            return protocol_error(413, -32600, "Request body exceeds 256 KiB");
        }
        match serde_json::from_slice(&bytes) {
            Ok(value) => Some(value),
            Err(_) => return protocol_error(400, -32700, "Parse error: invalid JSON"),
        }
    } else {
        None
    };
    if headers.contains_key(header::ORIGIN) {
        return (StatusCode::FORBIDDEN, Json(json!({ "error": "Browser access is not allowed" }))).into_response();
    }
    let credential = bearer(&headers).unwrap_or_default();
    if state.mcp.authenticate(&session, &credential).is_none() {
        let value = challenge(&state.public_url, &session, "invalid_token", "whatsapp:read");
        let mut response = (StatusCode::UNAUTHORIZED, Json(json!({ "error": "Token inválido, expirado ou de outra sessão" }))).into_response();
        if let Ok(value) = HeaderValue::from_str(&value) {
            response.headers_mut().insert(header::WWW_AUTHENTICATE, value);
        }
        return response;
    }
    if method != Method::POST {
        let mut response = (StatusCode::METHOD_NOT_ALLOWED, Json(json!({ "error": "Use MCP Streamable HTTP POST" }))).into_response();
        response.headers_mut().insert(header::ALLOW, HeaderValue::from_static("POST"));
        return response;
    }
    let Some(body) = body else {
        return protocol_error(400, -32700, "Parse error: invalid JSON");
    };
    let call = Call { state: &state, session_id: &session, credential: &credential };
    serve(&call, &body, &headers).await
}
