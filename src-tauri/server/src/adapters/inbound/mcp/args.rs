//! Validates tool arguments against the catalog schemas (the subset of JSON Schema the tools use)
//! and applies defaults, with zod-like messages so clients can correct their calls.
use super::catalog::Tool;
use regex::Regex;
use serde_json::{Map, Value};

fn kind(value: &Value) -> &'static str {
    match value {
        Value::Null => "null",
        Value::Bool(_) => "boolean",
        Value::Number(_) => "number",
        Value::String(_) => "string",
        Value::Array(_) => "array",
        Value::Object(_) => "object",
    }
}

fn number(schema: &Value, key: &str) -> Option<f64> {
    schema.get(key).and_then(Value::as_f64)
}

fn check_number(schema: &Value, n: f64, integer: bool) -> Option<String> {
    if integer && n.fract() != 0.0 {
        return Some("Invalid input: expected int, received number".into());
    }
    if let Some(min) = number(schema, "exclusiveMinimum").filter(|m| n <= *m) {
        return Some(format!("Too small: expected number to be >{min}"));
    }
    if let Some(min) = number(schema, "minimum").filter(|m| n < *m) {
        return Some(format!("Too small: expected number to be >={min}"));
    }
    number(schema, "maximum")
        .filter(|m| n > *m)
        .map(|max| format!("Too big: expected number to be <={max}"))
}

fn check_string(schema: &Value, s: &str) -> Option<String> {
    let length = s.encode_utf16().count() as f64;
    if let Some(min) = number(schema, "minLength").filter(|m| length < *m) {
        return Some(format!("Too small: expected string to have >={min} characters"));
    }
    if let Some(max) = number(schema, "maxLength").filter(|m| length > *m) {
        return Some(format!("Too big: expected string to have <={max} characters"));
    }
    let pattern = schema.get("pattern").and_then(Value::as_str)?;
    let matches = Regex::new(pattern).is_ok_and(|r| r.is_match(s));
    (!matches).then(|| format!("Invalid string: must match pattern /{pattern}/"))
}

/// The problem with `value` under `schema`, if any.
fn problem(schema: &Value, value: &Value) -> Option<String> {
    if let Some(options) = schema.get("anyOf").and_then(Value::as_array) {
        return if options.iter().any(|o| problem(o, value).is_none()) {
            None
        } else {
            Some("Invalid input".into())
        };
    }
    let expected = schema.get("type").and_then(Value::as_str).unwrap_or("any");
    let mismatch = || Some(format!("Invalid input: expected {expected}, received {}", kind(value)));
    match (expected, value) {
        ("string", Value::String(s)) => {
            if let Some(options) = schema.get("enum").and_then(Value::as_array) {
                if !options.iter().any(|o| o == value) {
                    let list: Vec<String> = options.iter().map(|o| o.to_string()).collect();
                    return Some(format!("Invalid option: expected one of {}", list.join("|")));
                }
            }
            check_string(schema, s)
        }
        ("number", Value::Number(n)) => check_number(schema, n.as_f64().unwrap_or(f64::NAN), false),
        ("integer", Value::Number(n)) => check_number(schema, n.as_f64().unwrap_or(f64::NAN), true),
        ("boolean", Value::Bool(_)) | ("null", Value::Null) | ("any", _) => None,
        ("array", Value::Array(items)) => {
            if let Some(max) = number(schema, "maxItems").filter(|m| items.len() as f64 > *m) {
                return Some(format!("Too big: expected array to have <={max} items"));
            }
            let item_schema = schema.get("items").cloned().unwrap_or(Value::Null);
            items.iter().find_map(|item| problem(&item_schema, item))
        }
        _ => mismatch(),
    }
}

/// Returns the arguments with defaults applied, or the validation message.
pub fn validate(tool: &Tool, arguments: Option<&Value>) -> Result<Map<String, Value>, String> {
    let empty = Map::new();
    let given = match arguments {
        None | Some(Value::Null) => &empty,
        Some(Value::Object(map)) => map,
        Some(other) => return Err(format!("Invalid input: expected object, received {}", kind(other))),
    };
    let mut output = Map::new();
    let mut issues = Vec::new();
    let properties = tool.properties.as_object().cloned().unwrap_or_default();
    for (key, schema) in &properties {
        match given.get(key) {
            Some(value) => match problem(schema, value) {
                Some(issue) => issues.push(format!("{key}: {issue}")),
                None => {
                    output.insert(key.clone(), value.clone());
                }
            },
            None if tool.required.contains(&key.as_str()) => {
                let expected = schema.get("type").and_then(Value::as_str).unwrap_or("value");
                issues.push(format!("{key}: Invalid input: expected {expected}, received undefined"));
            }
            None => {
                if let Some(default) = schema.get("default") {
                    output.insert(key.clone(), default.clone());
                }
            }
        }
    }
    if issues.is_empty() {
        Ok(output)
    } else {
        Err(format!(
            "Input validation error: Invalid arguments for tool {}: {}",
            tool.name,
            issues.join("; ")
        ))
    }
}
