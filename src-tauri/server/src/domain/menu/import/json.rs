//! Lenient readers over captured JSON (ids may be strings or numbers, fields may be missing).
use crate::domain::menu::money::cents;
use serde_json::Value;

/// Non-empty text (numbers are turned into text, e.g. numeric ids).
pub fn text(value: &Value, key: &str) -> Option<String> {
    match value.get(key)? {
        Value::String(s) if !s.trim().is_empty() => Some(s.trim().to_string()),
        Value::Number(n) => Some(n.to_string()),
        _ => None,
    }
}

pub fn number(value: &Value, key: &str) -> Option<f64> {
    match value.get(key)? {
        Value::Number(n) => n.as_f64(),
        Value::String(s) => s.trim().replace(',', ".").parse().ok(),
        _ => None,
    }
}

pub fn int(value: &Value, key: &str) -> Option<i64> {
    number(value, key).map(|n| n as i64)
}

pub fn array<'a>(value: &'a Value, key: &str) -> &'a [Value] {
    value.get(key).and_then(Value::as_array).map_or(&[], Vec::as_slice)
}

/// Reais in cents from a number or a `{ value }` object.
pub fn price(value: &Value, key: &str) -> Option<i64> {
    match value.get(key)? {
        Value::Object(_) => number(&value[key], "value").map(cents),
        _ => number(value, key).map(cents),
    }
}

/// The `originalValue` of a `{ value, originalValue }` price.
pub fn original_price(value: &Value, key: &str) -> Option<i64> {
    value.get(key).and_then(|p| number(p, "originalValue")).map(cents)
}

/// `AVAILABLE`/`UNAVAILABLE` (any case); missing means available.
pub fn status(value: &Value) -> String {
    match text(value, "status").map(|s| s.to_ascii_uppercase()) {
        Some(s) if s != "AVAILABLE" => "unavailable".into(),
        _ => "available".into(),
    }
}

/// Depth-first search for the first value accepted by `found` (bounded depth and size).
pub fn find<'a, T>(value: &'a Value, depth: usize, found: &dyn Fn(&'a Value) -> Option<T>) -> Option<T> {
    if let Some(hit) = found(value) {
        return Some(hit);
    }
    if depth == 0 {
        return None;
    }
    match value {
        Value::Object(map) => map.values().find_map(|v| find(v, depth - 1, found)),
        Value::Array(items) => items.iter().take(500).find_map(|v| find(v, depth - 1, found)),
        _ => None,
    }
}
