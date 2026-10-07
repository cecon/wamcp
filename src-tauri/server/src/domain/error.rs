//! Error types shared by every layer. `Helpdesk` errors carry an HTTP status and a message that is
//! safe to show to the user; `Internal` errors never leak their detail to clients.

/// A business rule violation, shown to the user as `{ "error": message }` with `status`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HelpdeskError {
    pub status: u16,
    pub message: String,
}

impl HelpdeskError {
    pub fn new(message: impl Into<String>) -> Self {
        Self::with_status(message, 400)
    }

    pub fn with_status(message: impl Into<String>, status: u16) -> Self {
        Self {
            status,
            message: message.into(),
        }
    }

    pub fn not_found(message: impl Into<String>) -> Self {
        Self::with_status(message, 404)
    }
}

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("{}", .0.message)]
    Helpdesk(HelpdeskError),
    #[error("internal: {0}")]
    Internal(String),
}

impl Error {
    pub fn internal(detail: impl std::fmt::Display) -> Self {
        Self::Internal(detail.to_string())
    }
}

impl From<HelpdeskError> for Error {
    fn from(error: HelpdeskError) -> Self {
        Self::Helpdesk(error)
    }
}

impl From<serde_json::Error> for Error {
    fn from(error: serde_json::Error) -> Self {
        Self::internal(error)
    }
}

pub type Result<T> = std::result::Result<T, Error>;

/// Shorthand for a 400 business error.
pub fn fail<T>(message: impl Into<String>) -> Result<T> {
    Err(HelpdeskError::new(message).into())
}

/// Shorthand for a business error with an explicit HTTP status.
pub fn fail_with<T>(message: impl Into<String>, status: u16) -> Result<T> {
    Err(HelpdeskError::with_status(message, status).into())
}
