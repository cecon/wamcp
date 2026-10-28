//! OpenCode's server events (`GET /event`, SSE) mapped to the engine's normalised run events.
//! Shapes checked against the OpenAPI document of opencode 1.18.25 (`GET /doc`).
use crate::application::ports::{RunEvent, Usage};
use serde_json::Value;

/// The session an event belongs to (`None` for server-wide events).
pub fn session_of(event: &Value) -> Option<&str> {
    let props = &event["properties"];
    props["sessionID"]
        .as_str()
        .or_else(|| props["part"]["sessionID"].as_str())
        .or_else(|| props["info"]["sessionID"].as_str())
}

/// Maps one event of our session; `None` for the ones the engine does not need.
pub fn map(event: &Value) -> Option<RunEvent> {
    let props = &event["properties"];
    match event["type"].as_str()? {
        "session.idle" => Some(RunEvent::Completed),
        "session.error" => {
            let error = &props["error"];
            let message = error["data"]["message"]
                .as_str()
                .or_else(|| error["name"].as_str())
                .unwrap_or("Erro do runtime OpenCode");
            if error["name"] == "MessageAbortedError" {
                Some(RunEvent::Cancelled)
            } else {
                Some(RunEvent::Failed(message.to_string()))
            }
        }
        "message.part.updated" => part(&props["part"]),
        "message.part.delta" => props["delta"].as_str().map(|d| RunEvent::MessageDelta(d.into())),
        _ => None,
    }
}

fn part(part: &Value) -> Option<RunEvent> {
    match part["type"].as_str()? {
        // One per model step: summing them gives the run's usage without double counting.
        "step-finish" => {
            let tokens = &part["tokens"];
            let int = |v: &Value| v.as_f64().map_or(0, |f| f as i64);
            Some(RunEvent::UsageReported(Usage {
                input_tokens: int(&tokens["input"]),
                output_tokens: int(&tokens["output"]) + int(&tokens["reasoning"]),
                cached_tokens: int(&tokens["cache"]["read"]),
                cost_usd: part["cost"].as_f64(),
            }))
        }
        "tool" => {
            let tool = part["tool"].as_str().unwrap_or_default().to_string();
            match part["state"]["status"].as_str()? {
                "running" => Some(RunEvent::ToolRequested { tool }),
                "completed" => Some(RunEvent::ToolCompleted { tool, ok: true }),
                "error" => Some(RunEvent::ToolCompleted { tool, ok: false }),
                _ => None,
            }
        }
        _ => None,
    }
}

/// Splits an SSE buffer into complete `data:` payloads, keeping the unfinished tail.
pub fn drain_sse(buffer: &mut String) -> Vec<Value> {
    let mut events = Vec::new();
    while let Some(end) = buffer.find("\n\n") {
        let chunk: String = buffer.drain(..end + 2).collect();
        let data: Vec<&str> = chunk
            .lines()
            .filter_map(|line| line.strip_prefix("data:"))
            .map(str::trim_start)
            .collect();
        if let Ok(value) = serde_json::from_str::<Value>(&data.join("\n")) {
            events.push(value);
        }
    }
    events
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn maps_usage_idle_and_errors() {
        let step = json!({"type": "message.part.updated", "properties": {"part": {
            "type": "step-finish", "sessionID": "ses_1", "cost": 0.0123,
            "tokens": {"input": 1000, "output": 200, "reasoning": 50, "cache": {"read": 300, "write": 0}}}}});
        assert_eq!(session_of(&step), Some("ses_1"));
        assert_eq!(
            map(&step),
            Some(RunEvent::UsageReported(Usage {
                input_tokens: 1000,
                output_tokens: 250,
                cached_tokens: 300,
                cost_usd: Some(0.0123)
            }))
        );
        let idle = json!({"type": "session.idle", "properties": {"sessionID": "ses_1"}});
        assert_eq!(map(&idle), Some(RunEvent::Completed));
        let error = json!({"type": "session.error", "properties": {"sessionID": "ses_1",
            "error": {"name": "ProviderAuthError", "data": {"message": "chave inválida"}}}});
        assert_eq!(map(&error), Some(RunEvent::Failed("chave inválida".into())));
    }

    #[test]
    fn drains_complete_sse_events_only() {
        let mut buffer = "data: {\"type\":\"a\"}\n\ndata: {\"type\":\"b\"}\n\ndata: {\"ty".to_string();
        let events = drain_sse(&mut buffer);
        assert_eq!(events.len(), 2);
        assert_eq!(buffer, "data: {\"ty");
    }
}
