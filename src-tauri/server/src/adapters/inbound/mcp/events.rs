//! MCP events methods (`events/list`, `events/subscribe`, `events/unsubscribe`) with strict params.
use super::dispatch::Outcome;
use super::tools::Call;
use crate::domain::events::{EventError, EventOwner, JID};
use serde_json::{json, Map, Value};

fn invalid(method: &str, problem: &str) -> Outcome {
    Outcome::error(200, -32602, format!("Invalid params for {method}: {problem}"))
}

fn only(object: &Map<String, Value>, allowed: &[&str]) -> Option<String> {
    object
        .keys()
        .find(|k| !allowed.contains(&k.as_str()))
        .map(|k| format!("Unrecognized key: \"{k}\""))
}

/// The zod-equivalent shape check of each method's params; the domain validates the rest.
fn check(method: &str, params: &Value) -> Option<String> {
    let object = params.as_object()?;
    if method == "events/list" {
        if let Some(extra) = only(object, &["cursor", "_meta"]) {
            return Some(extra);
        }
        return (!matches!(object.get("cursor"), None | Some(Value::Null)))
            .then(|| "cursor: Invalid input: expected null, received string".into());
    }
    let subscribing = method == "events/subscribe";
    let keys: &[&str] = if subscribing {
        &["name", "arguments", "_meta", "delivery", "cursor", "ttlMs"]
    } else {
        &["name", "arguments", "_meta", "delivery"]
    };
    if let Some(extra) = only(object, keys) {
        return Some(extra);
    }
    if object.get("name").and_then(Value::as_str) != Some("message.created") {
        return Some("name: Invalid input: expected \"message.created\"".into());
    }
    if let Some(arguments) = object.get("arguments") {
        let Some(arguments) = arguments.as_object() else {
            return Some("arguments: Invalid input: expected object".into());
        };
        if let Some(extra) = only(arguments, &["jid"]) {
            return Some(format!("arguments: {extra}"));
        }
        if arguments
            .get("jid")
            .is_some_and(|j| !j.as_str().is_some_and(|j| j.len() <= 200 && JID.is_match(j)))
        {
            return Some("arguments.jid: Invalid string".into());
        }
    }
    let delivery = object.get("delivery").and_then(Value::as_object);
    let Some(delivery) = delivery else {
        return Some("delivery: Invalid input: expected object, received undefined".into());
    };
    let destination: &[&str] = if subscribing {
        &["mode", "url", "secret"]
    } else {
        &["mode", "url"]
    };
    if let Some(extra) = only(delivery, destination) {
        return Some(format!("delivery: {extra}"));
    }
    if delivery.get("mode").and_then(Value::as_str) != Some("webhook") {
        return Some("delivery.mode: Invalid input: expected \"webhook\"".into());
    }
    if delivery
        .get("url")
        .and_then(Value::as_str)
        .is_none_or(|u| u.len() > 2048)
    {
        return Some("delivery.url: Invalid input".into());
    }
    if subscribing {
        if delivery
            .get("secret")
            .and_then(Value::as_str)
            .is_none_or(|s| s.len() > 100)
        {
            return Some("delivery.secret: Invalid input".into());
        }
        if !matches!(object.get("cursor"), None | Some(Value::Null)) {
            return Some("cursor: Invalid input: expected null, received string".into());
        }
        let ttl_ok = match object.get("ttlMs") {
            None | Some(Value::Null) => true,
            Some(v) => v.as_i64().is_some_and(|t| t > 0),
        };
        if !ttl_ok {
            return Some("ttlMs: Invalid input".into());
        }
    }
    None
}

fn failure(error: EventError) -> Outcome {
    let data = error.reason.map(|reason| json!({ "reason": reason }));
    Outcome::Error {
        status: 200,
        code: error.code,
        message: error.message,
        data,
    }
}

pub async fn handle(call: &Call<'_>, method: &str, params: &Value) -> Outcome {
    let Some(events) = call.state.events.as_ref() else {
        return Outcome::not_found();
    };
    if let Some(problem) = check(method, params) {
        return invalid(method, &problem);
    }
    let Some(token) = call.state.mcp.authenticate(call.session_id, call.credential) else {
        return failure(EventError::coded("Acesso ao evento revogado ou expirado", -32001));
    };
    let owner = EventOwner {
        session_id: call.session_id.into(),
        principal_id: token.id,
        principal_kind: if token.client_id.is_some() { "oauth" } else { "token" }.into(),
    };
    let result = match method {
        "events/list" => Ok(events.list()),
        "events/subscribe" => events.subscribe(owner, params).await,
        _ => events.unsubscribe(owner, params).await,
    };
    match result {
        Ok(value) => Outcome::Result(value),
        Err(error) => failure(error),
    }
}
