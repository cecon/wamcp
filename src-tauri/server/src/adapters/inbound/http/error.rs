//! HTTP error responses: business errors keep their status and message, invalid input is a 400
//! "Dados inválidos", and internal failures never leak their detail.
use crate::domain::error::Error;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::json;

pub const INVALID: &str = "Dados inválidos";

#[derive(Debug)]
pub enum ApiError {
    App(Error),
    /// Malformed JSON, wrong types or values outside the accepted ranges.
    Invalid,
    TooLarge,
    Status(StatusCode, &'static str),
}

impl From<Error> for ApiError {
    fn from(error: Error) -> Self {
        Self::App(error)
    }
}

impl From<crate::domain::error::HelpdeskError> for ApiError {
    fn from(error: crate::domain::error::HelpdeskError) -> Self {
        Self::App(error.into())
    }
}

pub fn error_body(status: StatusCode, message: &str) -> Response {
    (status, Json(json!({ "error": message }))).into_response()
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        match self {
            Self::App(Error::Helpdesk(e)) => {
                let status = StatusCode::from_u16(e.status).unwrap_or(StatusCode::BAD_REQUEST);
                error_body(status, &e.message)
            }
            Self::App(Error::Internal(detail)) => {
                tracing::error!("request failed: {detail}");
                error_body(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Não foi possível concluir a operação",
                )
            }
            Self::Invalid => error_body(StatusCode::BAD_REQUEST, INVALID),
            Self::TooLarge => error_body(StatusCode::PAYLOAD_TOO_LARGE, INVALID),
            Self::Status(status, message) => error_body(status, message),
        }
    }
}

pub type ApiResult<T> = Result<T, ApiError>;

/// `Ok(json)` shorthand for handlers.
pub fn ok<T: serde::Serialize>(value: T) -> ApiResult<Response> {
    Ok(Json(value).into_response())
}

/// `201 Created` with a JSON body.
pub fn created<T: serde::Serialize>(value: T) -> ApiResult<Response> {
    Ok((StatusCode::CREATED, Json(value)).into_response())
}

pub fn done() -> ApiResult<Response> {
    ok(json!({ "ok": true }))
}

impl From<serde_json::Error> for ApiError {
    fn from(error: serde_json::Error) -> Self {
        Self::App(error.into())
    }
}
