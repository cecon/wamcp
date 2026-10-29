//! The engine's MCP endpoint (`POST /engine/mcp`): the only tools an agent runtime gets. The bearer is
//! the run's token, so the engine knows the agent, activity and organization of every call. Tool
//! names travel with `__` instead of `.` (model APIs reject dots in function names).
use super::http::state::AppState;
use crate::application::ports::ToolGateway;
use axum::body::Bytes;
use axum::extract::State;
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::{json, Value};

const BODY_LIMIT: usize = 256 * 1024;

fn wire(name: &str) -> String {
    name.replace('.', "__")
}

fn unwire(name: &str) -> String {
    name.replace("__", ".")
}

fn rpc(id: Value, result: Result<Value, (i64, &str)>) -> Response {
    let body = match result {
        Ok(result) => json!({"jsonrpc": "2.0", "id": id, "result": result}),
        Err((code, message)) => json!({"jsonrpc": "2.0", "id": id, "error": {"code": code, "message": message}}),
    };
    Json(body).into_response()
}

pub async fn endpoint(State(state): State<AppState>, headers: HeaderMap, bytes: Bytes) -> Response {
    let Some(engine) = state.support.as_ref().and_then(|s| s.engine.get()) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    if headers.contains_key(header::ORIGIN) {
        return (
            StatusCode::FORBIDDEN,
            Json(json!({"error": "Browser access is not allowed"})),
        )
            .into_response();
    }
    let token = headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .unwrap_or_default()
        .to_string();
    if token.is_empty() || engine.caller_ok(&token).is_err() {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({"error": "Token de execução inválido ou encerrado"})),
        )
            .into_response();
    }
    if bytes.len() > BODY_LIMIT {
        return StatusCode::PAYLOAD_TOO_LARGE.into_response();
    }
    let Ok(body) = serde_json::from_slice::<Value>(&bytes) else {
        return rpc(Value::Null, Err((-32700, "Parse error")));
    };
    let Some(id) = body.get("id").cloned() else {
        return StatusCode::ACCEPTED.into_response();
    };
    let params = &body["params"];
    match body["method"].as_str().unwrap_or_default() {
        "initialize" => {
            let version = params["protocolVersion"].as_str().unwrap_or("2025-06-18");
            rpc(
                id,
                Ok(json!({"protocolVersion": version, "capabilities": {"tools": {}},
                "serverInfo": {"name": "wamcp-engine", "version": env!("CARGO_PKG_VERSION")}})),
            )
        }
        "ping" => rpc(id, Ok(json!({}))),
        "tools/list" => {
            let tools: Vec<Value> = engine
                .list_tools(&token)
                .into_iter()
                .map(|t| json!({"name": wire(&t.name), "description": t.description, "inputSchema": t.input_schema}))
                .collect();
            rpc(id, Ok(json!({"tools": tools})))
        }
        "tools/call" => {
            let name = unwire(params["name"].as_str().unwrap_or_default());
            let args = params.get("arguments").cloned().unwrap_or_else(|| json!({}));
            let reply = engine.call_tool(&token, &name, args).await;
            rpc(
                id,
                Ok(json!({"content": [{"type": "text", "text": reply.content.to_string()}],
                "structuredContent": reply.content, "isError": !reply.ok})),
            )
        }
        _ => rpc(id, Err((-32601, "Method not found"))),
    }
}
