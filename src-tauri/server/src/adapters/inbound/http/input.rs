//! Request input: a JSON body extractor (256 KiB, JSON only) and validation helpers that mirror the
//! constraints of the original zod schemas (trimming, lengths, enums, positive ids).
use super::error::ApiError;
use axum::body::Bytes;
use axum::extract::{FromRequest, Request};
use axum::http::header::CONTENT_TYPE;
use regex::Regex;
use serde::de::DeserializeOwned;
use std::collections::HashMap;
use std::sync::LazyLock;

pub const BODY_LIMIT: usize = 256 * 1024;

/// A JSON request body deserialized into `T`; anything else is "Dados inválidos".
pub struct Body<T>(pub T);

pub fn is_json(content_type: Option<&str>) -> bool {
    content_type
        .and_then(|v| v.split(';').next())
        .is_some_and(|m| m.trim().eq_ignore_ascii_case("application/json") || m.trim().ends_with("+json"))
}

impl<S: Send + Sync, T: DeserializeOwned> FromRequest<S> for Body<T> {
    type Rejection = ApiError;

    async fn from_request(request: Request, state: &S) -> Result<Self, ApiError> {
        let json = is_json(request.headers().get(CONTENT_TYPE).and_then(|v| v.to_str().ok()));
        let bytes = Bytes::from_request(request, state)
            .await
            .map_err(|_| ApiError::TooLarge)?;
        if bytes.len() > BODY_LIMIT {
            return Err(ApiError::TooLarge);
        }
        if !json {
            return Err(ApiError::Invalid);
        }
        serde_json::from_slice(&bytes).map(Body).map_err(|_| ApiError::Invalid)
    }
}

pub type Query = HashMap<String, String>;

/// Positive integer path or query parameter (`z.coerce.number().int().positive()`).
pub fn id(value: &str) -> Result<i64, ApiError> {
    value
        .trim()
        .parse::<i64>()
        .ok()
        .filter(|v| *v > 0)
        .ok_or(ApiError::Invalid)
}

pub fn optional_id(query: &Query, key: &str) -> Result<Option<i64>, ApiError> {
    query.get(key).map(|v| id(v)).transpose()
}

/// Integer query parameter with a default and inclusive bounds.
pub fn int_param(query: &Query, key: &str, default: i64, min: i64, max: i64) -> Result<i64, ApiError> {
    match query.get(key) {
        None => Ok(default),
        Some(v) => v
            .trim()
            .parse::<i64>()
            .ok()
            .filter(|n| (min..=max).contains(n))
            .ok_or(ApiError::Invalid),
    }
}

/// Trimmed text between `min` and `max` characters.
pub fn text(value: &str, min: usize, max: usize) -> Result<String, ApiError> {
    let trimmed = value.trim();
    let length = trimmed.chars().count();
    if (min..=max).contains(&length) {
        Ok(trimmed.to_string())
    } else {
        Err(ApiError::Invalid)
    }
}

pub fn optional_text(value: Option<&str>, min: usize, max: usize) -> Result<Option<String>, ApiError> {
    value.map(|v| text(v, min, max)).transpose()
}

/// Untrimmed text bounded by length.
pub fn raw(value: &str, min: usize, max: usize) -> Result<String, ApiError> {
    let length = value.chars().count();
    if (min..=max).contains(&length) {
        Ok(value.to_string())
    } else {
        Err(ApiError::Invalid)
    }
}

/// Nullable trimmed text: `Some(None)` clears the field.
pub fn nullable_text(value: Option<Option<String>>, max: usize) -> Result<Option<Option<String>>, ApiError> {
    match value {
        Some(Some(v)) => Ok(Some(Some(text(&v, 0, max)?))),
        other => Ok(other),
    }
}

pub fn one_of(value: &str, allowed: &[&str]) -> Result<String, ApiError> {
    if allowed.contains(&value) {
        Ok(value.to_string())
    } else {
        Err(ApiError::Invalid)
    }
}

static EMAIL: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^[A-Za-z0-9_'+\-.]*[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$").expect("valid regex")
});

pub fn email(value: &str) -> Result<String, ApiError> {
    let trimmed = text(value, 1, 200)?;
    if EMAIL.is_match(&trimmed) && !trimmed.starts_with('.') && !trimmed.contains("..") {
        Ok(trimmed)
    } else {
        Err(ApiError::Invalid)
    }
}

pub fn ids(values: &[i64], min: usize, max: usize) -> Result<Vec<i64>, ApiError> {
    if (min..=max).contains(&values.len()) && values.iter().all(|v| *v > 0) {
        Ok(values.to_vec())
    } else {
        Err(ApiError::Invalid)
    }
}

pub fn check(condition: bool) -> Result<(), ApiError> {
    if condition {
        Ok(())
    } else {
        Err(ApiError::Invalid)
    }
}
