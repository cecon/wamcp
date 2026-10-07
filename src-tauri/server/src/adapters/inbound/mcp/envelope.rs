//! Era classification and the modern (2026-07-28) validation ladder: JSON-RPC shape, the per-request
//! `_meta` envelope and the standard request headers, with the official SDK's error codes.
use axum::http::HeaderMap;
use serde_json::{json, Value};

pub const MODERN: &str = "2026-07-28";
pub const LEGACY_VERSIONS: [&str; 5] = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05", "2024-10-07"];
pub const VERSION_KEY: &str = "io.modelcontextprotocol/protocolVersion";
pub const CAPABILITIES_KEY: &str = "io.modelcontextprotocol/clientCapabilities";
pub const CLIENT_KEY: &str = "io.modelcontextprotocol/clientInfo";
pub const SERVER_KEY: &str = "io.modelcontextprotocol/serverInfo";

/// A JSON-RPC error answered before dispatch, with its HTTP status.
#[derive(Debug, Clone, PartialEq)]
pub struct Rejection {
    pub status: u16,
    pub code: i64,
    pub message: String,
    pub data: Option<Value>,
    pub id: Value,
}

impl Rejection {
    pub fn body(&self) -> Value {
        let mut error = json!({ "code": self.code, "message": self.message });
        if let Some(data) = &self.data {
            error["data"] = data.clone();
        }
        json!({ "jsonrpc": "2.0", "error": error, "id": self.id })
    }
}

pub fn header<'a>(headers: &'a HeaderMap, name: &str) -> Option<&'a str> {
    headers.get(name).and_then(|v| v.to_str().ok())
}

fn meta(message: &Value) -> Option<&serde_json::Map<String, Value>> {
    message.get("params")?.get("_meta")?.as_object()
}

/// A body claims the modern era through its envelope (or the header names a modern revision).
pub fn is_modern(body: &Value, headers: &HeaderMap) -> bool {
    let claims = |m: &Value| meta(m).is_some_and(|meta| meta.contains_key(VERSION_KEY));
    let header_modern = header(headers, "mcp-protocol-version").is_some_and(|v| v >= MODERN);
    match body {
        Value::Array(items) => items.iter().any(claims),
        other => claims(other) || header_modern,
    }
}

/// The request id when it is safe to echo (a string or number on a message with a string method).
pub fn echo_id(body: &Value) -> Value {
    let valid_id = matches!(body.get("id"), Some(Value::String(_)) | Some(Value::Number(_)));
    if valid_id && body.get("method").is_some_and(Value::is_string) {
        body["id"].clone()
    } else {
        Value::Null
    }
}

fn invalid(body: &Value, message: &str) -> Rejection {
    Rejection { status: 400, code: -32600, message: message.into(), data: None, id: echo_id(body) }
}

/// Validates a JSON-RPC request or notification shape.
pub fn shape(body: &Value) -> Result<(), Rejection> {
    let not_rpc = "Bad Request: the request body is not a valid JSON-RPC message";
    if body.is_array() {
        let message = format!("Bad Request: JSON-RPC batches may not contain requests for protocol revision {MODERN} or later");
        return Err(Rejection { id: Value::Null, ..invalid(body, &message) });
    }
    let Some(object) = body.as_object() else {
        return Err(invalid(body, not_rpc));
    };
    let id_ok = match object.get("id") {
        None => true,
        Some(Value::String(_)) => true,
        Some(Value::Number(n)) => n.is_i64() || n.is_u64(),
        _ => false,
    };
    let params_ok = object.get("params").is_none_or(Value::is_object);
    let valid = object.get("jsonrpc") == Some(&json!("2.0")) && object.get("method").is_some_and(Value::is_string) && id_ok && params_ok;
    if valid {
        Ok(())
    } else {
        let id = if id_ok { echo_id(body) } else { Value::Null };
        Err(Rejection { id, ..invalid(body, not_rpc) })
    }
}

fn type_name(value: &Value) -> &'static str {
    match value {
        Value::Null => "null",
        Value::Bool(_) => "boolean",
        Value::Number(_) => "number",
        Value::String(_) => "string",
        Value::Array(_) => "array",
        Value::Object(_) => "object",
    }
}

fn envelope_error(body: &Value, revision: &str, key: &str, problem: String) -> Rejection {
    Rejection {
        status: 400,
        code: -32602,
        message: format!("Invalid _meta envelope for protocol revision {revision}: {key}: {problem}"),
        data: Some(json!({ "envelope": { "key": key, "problem": problem } })),
        id: echo_id(body),
    }
}

/// Checks the envelope and header agreement; returns the claimed protocol revision.
pub fn envelope(body: &Value, headers: &HeaderMap) -> Result<String, Rejection> {
    let header_version = header(headers, "mcp-protocol-version");
    let revision = header_version.unwrap_or(MODERN).to_string();
    let empty = serde_json::Map::new();
    let meta = meta(body).unwrap_or(&empty);
    let missing: Vec<&str> = [VERSION_KEY, CAPABILITIES_KEY].into_iter().filter(|k| !meta.contains_key(*k)).collect();
    if !missing.is_empty() {
        return Err(Rejection {
            status: 400,
            code: -32602,
            message: format!("Invalid params: the MCP-Protocol-Version header names protocol revision {revision}, but the request is missing the required per-request envelope key(s): {}", missing.join(", ")),
            data: Some(json!({ "envelope": { "missing": missing } })),
            id: echo_id(body),
        });
    }
    let expect = |key: &str, kind: &str| -> Result<(), Rejection> {
        match meta.get(key) {
            Some(v) if type_name(v) != kind => {
                Err(envelope_error(body, &revision, key, format!("Invalid input: expected {kind}, received {}", type_name(v))))
            }
            _ => Ok(()),
        }
    };
    expect(VERSION_KEY, "string")?;
    expect(CAPABILITIES_KEY, "object")?;
    expect(CLIENT_KEY, "object")?;
    let claimed = meta[VERSION_KEY].as_str().unwrap_or_default().to_string();
    if let Some(header_version) = header_version.filter(|h| *h != claimed) {
        let detail = format!("the body envelope names protocol version {claimed} but the MCP-Protocol-Version header names {header_version}");
        return Err(mismatch(body, header_version, &detail));
    }
    if claimed != MODERN {
        return Err(Rejection {
            status: 400,
            code: -32022,
            message: format!("Unsupported protocol version: {claimed}"),
            data: Some(json!({ "supported": [MODERN], "requested": claimed })),
            id: echo_id(body),
        });
    }
    Ok(claimed)
}

fn mismatch(body: &Value, header: &str, detail: &str) -> Rejection {
    Rejection {
        status: 400,
        code: -32020,
        message: format!("Bad Request: the request headers and body disagree: {detail}"),
        data: Some(json!({ "mismatch": { "header": header, "body": detail } })),
        id: echo_id(body),
    }
}

/// `Mcp-Method` must match the body method and, for tools/call, `Mcp-Name` the tool name.
pub fn routing_headers(body: &Value, headers: &HeaderMap) -> Result<(), Rejection> {
    let method = body["method"].as_str().unwrap_or_default();
    if let Some(named) = header(headers, "mcp-method").filter(|h| *h != method) {
        return Err(mismatch(body, named, &format!("the body names method {method} but the Mcp-Method header names {named}")));
    }
    if method == "tools/call" {
        let name = body["params"]["name"].as_str().unwrap_or_default();
        if let Some(named) = header(headers, "mcp-name").filter(|h| *h != name) {
            let detail = format!("the body carries params.name=\"{name}\" but the Mcp-Name header names \"{named}\"");
            return Err(mismatch(body, named, &detail));
        }
    }
    Ok(())
}
