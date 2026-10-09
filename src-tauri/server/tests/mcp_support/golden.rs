//! Comparison of a replayed MCP reply with a golden case captured from the Node server: exact for
//! envelopes and errors, structural for tool results built from Node stub data.
use crate::common::http::Reply;
use serde_json::{json, Value};

const STRUCTURAL: [&str; 10] = [
    "session_status",
    "list_chats",
    "get_messages",
    "search",
    "send_writer",
    "media_audio",
    "list_conversations",
    "get_conversation",
    "reply_conversation",
    "events_subscribe",
];
const TOOL_FIELDS: [&str; 8] = [
    "name",
    "description",
    "inputSchema",
    "annotations",
    "securitySchemes",
    "_meta",
    "outputSchema",
    "execution",
];

/// Masks the server version (Node package version vs the Rust build's) in both protocol eras.
fn normalize(mut body: Value) -> Value {
    if let Some(info) = body.pointer_mut("/result/_meta/io.modelcontextprotocol~1serverInfo/version") {
        *info = json!("*");
    }
    if let Some(info) = body.pointer_mut("/result/serverInfo/version") {
        *info = json!("*");
    }
    body
}

fn kind(v: &Value) -> &'static str {
    match v {
        Value::Null => "null",
        Value::Bool(_) => "boolean",
        Value::Number(_) => "number",
        Value::String(_) => "string",
        Value::Array(_) => "array",
        Value::Object(_) => "object",
    }
}

/// Golden stub data → actual data: same JSON kinds, golden object keys present, arrays non-empty.
fn shape(golden: &Value, actual: &Value, path: &str, errors: &mut Vec<String>) {
    match (golden, actual) {
        (Value::Object(g), Value::Object(a)) => {
            for (key, value) in g {
                match a.get(key) {
                    Some(found) => shape(value, found, &format!("{path}.{key}"), errors),
                    None => errors.push(format!("{path}: missing key {key:?} (actual keys {:?})", a.keys())),
                }
            }
        }
        (Value::Array(g), Value::Array(a)) => match (g.first(), a.first()) {
            (Some(g0), Some(a0)) => shape(g0, a0, &format!("{path}[0]"), errors),
            (Some(_), None) => errors.push(format!("{path}: expected a non-empty array")),
            _ => {}
        },
        (g, a) if kind(g) != kind(a) => errors.push(format!("{path}: expected {}, got {}", kind(g), kind(a))),
        _ => {}
    }
}

/// Keys the Node capture stubs added that the real Node use case never returns: the stub `reply`
/// echoed `display_id`, while the real `helpdesk.reply` returns the stored message row.
fn strip_stub_keys(name: &str, golden: &mut Value) {
    if name == "reply_conversation" {
        golden.as_object_mut().map(|o| o.remove("display_id"));
    }
}

fn structural(name: &str, golden: &Value, actual: &Value, errors: &mut Vec<String>) {
    for key in ["jsonrpc", "id", "error"] {
        if golden.get(key) != actual.get(key) {
            errors.push(format!(
                "{key}: expected {:?}, got {:?}",
                golden.get(key),
                actual.get(key)
            ));
        }
    }
    let (g, a) = (&golden["result"], &actual["result"]);
    let keys = |v: &Value| {
        v.as_object()
            .map(|o| o.keys().cloned().collect::<Vec<_>>())
            .unwrap_or_default()
    };
    let (mut gk, mut ak) = (keys(g), keys(a));
    gk.sort();
    ak.sort();
    if gk != ak {
        errors.push(format!("result keys: expected {gk:?}, got {ak:?}"));
    }
    for key in ["resultType", "isError", "_meta", "cursor", "truncated"] {
        if g.get(key) != a.get(key) {
            errors.push(format!("result.{key}: expected {:?}, got {:?}", g.get(key), a.get(key)));
        }
    }
    let content = |v: &Value| v["content"].as_array().cloned().unwrap_or_default();
    let (gc, ac) = (content(g), content(a));
    if gc.len() != ac.len() {
        errors.push(format!("content length: expected {}, got {}", gc.len(), ac.len()));
    }
    for (i, (gi, ai)) in gc.iter().zip(&ac).enumerate() {
        if gi["type"] != "text" {
            if gi != ai {
                errors.push(format!("content[{i}]: expected {gi}, got {ai}"));
            }
            continue;
        }
        let parse = |v: &Value| serde_json::from_str::<Value>(v["text"].as_str().unwrap_or_default());
        match (parse(gi), parse(ai)) {
            (Ok(mut gj), Ok(aj)) => {
                strip_stub_keys(name, &mut gj);
                shape(&gj, &aj, &format!("content[{i}]"), errors);
            }
            _ if gi != ai => errors.push(format!("content[{i}]: expected {gi}, got {ai}")),
            _ => {}
        }
    }
    if let Some(id) = g.get("id").filter(|v| v.is_string()) {
        if !a["id"].is_string() {
            errors.push(format!("result.id: expected a string like {id}, got {}", a["id"]));
        }
    }
}

fn exact(golden: &Value, actual: &Value, errors: &mut Vec<String>) {
    if let (Some(g), Some(a)) = (
        golden["result"]["tools"].as_array(),
        actual["result"]["tools"].as_array(),
    ) {
        let names = |t: &[Value]| t.iter().map(|t| t["name"].clone()).collect::<Vec<_>>();
        if names(g) != names(a) {
            errors.push(format!("tool names: expected {:?}, got {:?}", names(g), names(a)));
        }
        for (gt, at) in g.iter().zip(a) {
            for field in TOOL_FIELDS {
                if gt.get(field) != at.get(field) {
                    let (gf, af) = (gt.get(field), at.get(field));
                    errors.push(format!("tool {} {field}: expected {gf:?}, got {af:?}", gt["name"]));
                }
            }
        }
    }
    if golden != actual {
        errors.push(format!("body: expected {golden}, got {actual}"));
    }
}

/// The `catalog_*` tools were added after the Node capture; tool lists are compared without them.
fn without_catalog_tools(mut body: Value) -> Value {
    if let Some(tools) = body.pointer_mut("/result/tools").and_then(Value::as_array_mut) {
        tools.retain(|t| !t["name"].as_str().unwrap_or_default().starts_with("catalog_"));
    }
    body
}

/// Every difference between the golden `case` and the actual `reply`, prefixed with the case name.
pub fn compare(case: &Value, reply: &Reply) -> Vec<String> {
    let name = case["name"].as_str().unwrap_or_default();
    let mut errors = Vec::new();
    if reply.status as u64 != case["status"].as_u64().unwrap_or_default() {
        errors.push(format!("status: expected {}, got {}", case["status"], reply.status));
    }
    for header in ["www-authenticate", "allow", "mcp-session-id"] {
        let expected = case["headers"][header].as_str().map(String::from);
        if reply.header(header) != expected {
            errors.push(format!(
                "header {header}: expected {expected:?}, got {:?}",
                reply.header(header)
            ));
        }
    }
    let content_type = reply.header("content-type").unwrap_or_default();
    if case["headers"]["content-type"].is_string() && !content_type.starts_with("application/json") {
        errors.push(format!("content-type: got {content_type:?}"));
    }
    let golden = normalize(case["body"].clone());
    if golden.is_null() {
        if !reply.text.is_empty() {
            errors.push(format!("body: expected none, got {}", reply.text));
        }
    } else if STRUCTURAL.contains(&name) {
        structural(name, &golden, &normalize(reply.body.clone()), &mut errors);
    } else {
        exact(
            &golden,
            &without_catalog_tools(normalize(reply.body.clone())),
            &mut errors,
        );
    }
    errors.into_iter().map(|e| format!("[{name}] {e}")).collect()
}
