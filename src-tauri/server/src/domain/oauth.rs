//! OAuth 2.1 rules for MCP clients (ChatGPT connector and the desktop loopback callback).
use regex::Regex;
use std::sync::LazyLock;

pub const OAUTH_SCOPES: [&str; 2] = ["whatsapp:read", "whatsapp:send"];

/// An OAuth error code (`invalid_grant`, `invalid_scope`, …) with a user-facing description.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OAuthFailure {
    pub code: String,
    pub message: String,
}

pub fn oauth_require(condition: bool, message: &str, code: &str) -> Result<(), OAuthFailure> {
    if condition {
        Ok(())
    } else {
        Err(OAuthFailure {
            code: code.into(),
            message: message.into(),
        })
    }
}

/// Scopes granted for a session token scope (`read` or `read_write`).
pub fn scopes_for(scope: &str) -> Vec<String> {
    let all = if scope == "read_write" { 2 } else { 1 };
    OAUTH_SCOPES[..all].iter().map(|s| s.to_string()).collect()
}

pub fn scope_for(scopes: &[String]) -> &'static str {
    if scopes.iter().any(|s| s == "whatsapp:send") {
        "read_write"
    } else {
        "read"
    }
}

static LOOPBACK: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^/callback(?:/[A-Za-z0-9_-]{1,128})?$").expect("valid regex"));
static CONNECTOR: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^/connector/oauth/[A-Za-z0-9_-]+$").expect("valid regex"));

/// Only ChatGPT connector callbacks and the desktop app's loopback callback are accepted.
pub fn valid_oauth_redirect(value: &str) -> bool {
    let Ok(u) = url::Url::parse(value) else {
        return false;
    };
    if !u.username().is_empty() || u.password().is_some() || u.fragment().is_some() || u.query().is_some() {
        return false;
    }
    let host = u.host_str().unwrap_or_default();
    if u.scheme() == "http" && host == "127.0.0.1" {
        return u.port().is_some() && LOOPBACK.is_match(u.path());
    }
    u.scheme() == "https"
        && host == "chatgpt.com"
        && u.port().is_none()
        && (CONNECTOR.is_match(u.path()) || u.path() == "/connector_platform_oauth_redirect")
}
