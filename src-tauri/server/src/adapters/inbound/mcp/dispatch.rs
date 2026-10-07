//! JSON-RPC method dispatch shared by both protocol eras.
use super::args::validate;
use super::catalog::{describe, tools};
use super::envelope::{LEGACY_VERSIONS, MODERN, SERVER_KEY};
use super::events;
use super::tools::Call;
use serde_json::{json, Value};

/// The JSON-RPC outcome of one request and the HTTP status that carries it.
pub enum Outcome {
    Result(Value),
    Error { status: u16, code: i64, message: String, data: Option<Value> },
}

impl Outcome {
    pub fn error(status: u16, code: i64, message: impl Into<String>) -> Self {
        Self::Error { status, code, message: message.into(), data: None }
    }

    pub fn not_found() -> Self {
        Self::error(404, -32601, "Method not found")
    }
}

fn server_info(call: &Call) -> Value {
    json!({ "name": "wamcp", "version": call.state.version })
}

fn listed(call: &Call, modern: bool) -> Vec<Value> {
    let helpdesk = call.state.mcp.helpdesk.is_some();
    tools().iter().filter(|t| helpdesk || !t.helpdesk).map(|t| describe(t, modern)).collect()
}

async fn call_tool(call: &Call<'_>, params: &Value) -> Outcome {
    let name = params["name"].as_str().unwrap_or_default();
    let helpdesk = call.state.mcp.helpdesk.is_some();
    let catalog = tools();
    let Some(tool) = catalog.iter().find(|t| t.name == name && (helpdesk || !t.helpdesk)) else {
        return Outcome::error(200, -32602, format!("Tool {name} not found"));
    };
    match validate(tool, params.get("arguments")) {
        Ok(args) => Outcome::Result(call.run(tool, &args).await),
        Err(message) => Outcome::Result(json!({ "content": [{ "type": "text", "text": message }], "isError": true })),
    }
}

/// Modern (2026-07-28) requests: every result carries `resultType` and the server identity.
pub async fn modern(call: &Call<'_>, method: &str, params: &Value) -> Outcome {
    let has_events = call.state.events.is_some();
    let outcome = match method {
        "server/discover" => {
            let mut capabilities = json!({ "tools": { "listChanged": false } });
            if has_events {
                capabilities["events"] = json!({});
            }
            Outcome::Result(json!({ "supportedVersions": [MODERN], "capabilities": capabilities, "ttlMs": 0, "cacheScope": "private" }))
        }
        "tools/list" => Outcome::Result(json!({ "tools": listed(call, true), "ttlMs": 0, "cacheScope": "private" })),
        "tools/call" => call_tool(call, params).await,
        "events/list" | "events/subscribe" | "events/unsubscribe" if has_events => events::handle(call, method, params).await,
        _ => Outcome::not_found(),
    };
    match outcome {
        Outcome::Result(mut result) => {
            let info = server_info(call);
            result["resultType"] = json!("complete");
            match result.get_mut("_meta").and_then(Value::as_object_mut) {
                Some(meta) => {
                    meta.insert(SERVER_KEY.into(), info);
                }
                None => result["_meta"] = json!({ SERVER_KEY: info }),
            }
            Outcome::Result(result)
        }
        error => error,
    }
}

/// 2025-era stateless requests (initialize handshake, tools) served with JSON responses.
pub async fn legacy(call: &Call<'_>, method: &str, params: &Value) -> Outcome {
    match method {
        "initialize" => {
            let requested = params["protocolVersion"].as_str().unwrap_or_default();
            let version = if LEGACY_VERSIONS.contains(&requested) { requested } else { LEGACY_VERSIONS[0] };
            Outcome::Result(json!({
                "protocolVersion": version,
                "capabilities": { "tools": { "listChanged": true } },
                "serverInfo": server_info(call),
            }))
        }
        "ping" => Outcome::Result(json!({})),
        "tools/list" => Outcome::Result(json!({ "tools": listed(call, false) })),
        "tools/call" => call_tool(call, params).await,
        _ => Outcome::error(200, -32601, "Method not found"),
    }
}
