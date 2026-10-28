//! `/mcp-system`: the system agent's tools for its own runtime. Only Claude Code on this computer
//! reaches it, with the bearer token of a run in progress (never through the tunnel); stateless
//! 2025-era JSON-RPC over Streamable HTTP with JSON responses.
use super::envelope::LEGACY_VERSIONS;
use crate::adapters::inbound::http::auth::bearer;
use crate::adapters::inbound::http::rate_limit::Peer;
use crate::adapters::inbound::http::state::AppState;
use crate::domain::system::system_tools;
use axum::body::Bytes;
use axum::extract::State;
use axum::http::{header, HeaderMap, Method, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::{json, Value};

fn tool_list() -> Value {
    let tools: Vec<Value> = system_tools()
        .iter()
        .map(|t| json!({ "name": t.name, "description": t.description, "inputSchema": t.input }))
        .collect();
    json!({ "tools": tools })
}

fn answer(id: Value, result: std::result::Result<Value, (i64, String)>) -> Value {
    match result {
        Ok(result) => json!({ "jsonrpc": "2.0", "id": id, "result": result }),
        Err((code, message)) => json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } }),
    }
}

fn handle(state: &AppState, token: &str, method: &str, params: &Value) -> std::result::Result<Value, (i64, String)> {
    match method {
        "initialize" => {
            let requested = params["protocolVersion"].as_str().unwrap_or_default();
            let version = LEGACY_VERSIONS
                .iter()
                .find(|v| **v == requested)
                .unwrap_or(&LEGACY_VERSIONS[0]);
            Ok(json!({
                "protocolVersion": version,
                "capabilities": { "tools": { "listChanged": false } },
                "serverInfo": { "name": "wamcp-system", "version": state.version },
            }))
        }
        "ping" => Ok(json!({})),
        "tools/list" => Ok(tool_list()),
        "tools/call" => {
            let name = params["name"].as_str().unwrap_or_default();
            let args = params.get("arguments").cloned().unwrap_or(json!({}));
            let (text, error) = match state.support().system.call(token, name, &args) {
                Ok(value) => (value.to_string(), false),
                Err(e) => (e.to_string(), true),
            };
            Ok(json!({ "content": [{ "type": "text", "text": text }], "isError": error }))
        }
        _ => Err((-32601, "Method not found".into())),
    }
}

pub async fn endpoint(
    State(state): State<AppState>,
    peer: Peer,
    method: Method,
    headers: HeaderMap,
    bytes: Bytes,
) -> Response {
    let local = peer.0.is_none_or(|p| p.ip().is_loopback());
    let proxied = ["cf-connecting-ip", "x-forwarded-for"]
        .iter()
        .any(|h| headers.contains_key(*h));
    if !local || proxied || headers.contains_key(header::ORIGIN) {
        return StatusCode::NOT_FOUND.into_response();
    }
    let token = bearer(&headers).unwrap_or_default();
    if !state.support().system.authenticates(&token) {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({ "error": "Execução inválida ou encerrada" })),
        )
            .into_response();
    }
    if method != Method::POST {
        return StatusCode::METHOD_NOT_ALLOWED.into_response();
    }
    let Ok(body) = serde_json::from_slice::<Value>(&bytes) else {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "jsonrpc": "2.0", "id": null, "error": { "code": -32700, "message": "Parse error" } })),
        )
            .into_response();
    };
    let messages = match &body {
        Value::Array(items) => items.clone(),
        other => vec![other.clone()],
    };
    let mut replies = Vec::new();
    for message in &messages {
        let Some(id) = message.get("id").cloned() else {
            continue;
        };
        let method = message["method"].as_str().unwrap_or_default();
        let params = message.get("params").cloned().unwrap_or(json!({}));
        replies.push(answer(id, handle(&state, &token, method, &params)));
    }
    match (body.is_array(), replies.len()) {
        (_, 0) => StatusCode::ACCEPTED.into_response(),
        (false, _) => Json(replies.remove(0)).into_response(),
        (true, _) => Json(Value::Array(replies)).into_response(),
    }
}
