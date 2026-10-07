//! Fixed-window rate limiting per client key (like express-rate-limit's memory store).
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use parking_lot::Mutex;
use std::collections::HashMap;
use std::net::SocketAddr;
use std::time::{Duration, Instant};

pub struct RateLimiter {
    limit: u32,
    window: Duration,
    hits: Mutex<HashMap<String, (Instant, u32)>>,
}

impl RateLimiter {
    pub fn new(limit: u32, window_secs: u64) -> Self {
        Self {
            limit,
            window: Duration::from_secs(window_secs),
            hits: Mutex::new(HashMap::new()),
        }
    }

    /// Counts a hit; `false` when the client exceeded the limit in the current window.
    pub fn allow(&self, key: &str) -> bool {
        let now = Instant::now();
        let mut hits = self.hits.lock();
        if hits.len() > 10_000 {
            hits.retain(|_, (start, _)| now.duration_since(*start) < self.window);
        }
        let entry = hits.entry(key.to_string()).or_insert((now, 0));
        if now.duration_since(entry.0) >= self.window {
            *entry = (now, 0);
        }
        entry.1 += 1;
        entry.1 <= self.limit
    }

    pub fn check(&self, key: &str) -> Result<(), Response> {
        if self.allow(key) {
            Ok(())
        } else {
            Err((StatusCode::TOO_MANY_REQUESTS, "Too many requests, please try again later.").into_response())
        }
    }
}

/// Behind the Cloudflare tunnel every request comes from loopback, so key limits by the visitor IP.
pub fn client_key(headers: &HeaderMap, peer: Option<SocketAddr>) -> String {
    headers
        .get("cf-connecting-ip")
        .and_then(|v| v.to_str().ok())
        .map(str::to_string)
        .or_else(|| peer.map(|p| p.ip().to_string()))
        .unwrap_or_default()
}

/// The TCP peer address, when the server was started with connect info (absent in tests).
pub struct Peer(pub Option<SocketAddr>);

impl<S: Send + Sync> axum::extract::FromRequestParts<S> for Peer {
    type Rejection = std::convert::Infallible;

    async fn from_request_parts(parts: &mut axum::http::request::Parts, _state: &S) -> Result<Self, Self::Rejection> {
        let info = parts.extensions.get::<axum::extract::ConnectInfo<SocketAddr>>();
        Ok(Self(info.map(|i| i.0)))
    }
}
