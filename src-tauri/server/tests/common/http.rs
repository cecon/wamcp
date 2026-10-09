//! In-process HTTP calls against the admin and public routers (no sockets).
use super::Fixture;
use axum::body::Body;
use axum::http::{HeaderMap, Request};
use axum::Router;
use http_body_util::BodyExt;
use serde_json::Value;
use tower::ServiceExt;

#[derive(Debug, Clone)]
pub struct Reply {
    pub status: u16,
    pub headers: HeaderMap,
    pub body: Value,
    pub text: String,
}

impl Reply {
    pub fn header(&self, name: &str) -> Option<String> {
        self.headers.get(name).and_then(|v| v.to_str().ok()).map(String::from)
    }
}

/// Sends one request through a router and reads the whole response.
pub async fn send(router: &Router, request: Request<Body>) -> Reply {
    let response = router.clone().oneshot(request).await.expect("infallible router");
    let status = response.status().as_u16();
    let headers = response.headers().clone();
    let bytes = response
        .into_body()
        .collect()
        .await
        .map(|b| b.to_bytes())
        .unwrap_or_default();
    let text = String::from_utf8_lossy(&bytes).into_owned();
    let body = serde_json::from_str(&text).unwrap_or(Value::Null);
    Reply {
        status,
        headers,
        body,
        text,
    }
}

pub fn request(method: &str, path: &str, body: Option<Value>, headers: &[(&str, &str)]) -> Request<Body> {
    let mut builder = Request::builder().method(method).uri(path).header("host", "wamcp.test");
    if body.is_some() {
        builder = builder.header("content-type", "application/json");
    }
    for (name, value) in headers {
        builder = builder.header(*name, *value);
    }
    let body = body.map_or_else(Body::empty, |b| Body::from(b.to_string()));
    builder.body(body).expect("request")
}

/// A logged-in browser session: sends the cookie and the CSRF header like the agent UI.
#[derive(Clone)]
pub struct Agent {
    pub router: Router,
    pub cookie: String,
    pub csrf: String,
    pub user: Value,
}

impl Agent {
    pub fn id(&self) -> i64 {
        self.user["id"].as_i64().unwrap_or_default()
    }

    pub async fn call(&self, method: &str, path: &str, body: Option<Value>) -> Reply {
        let headers = [("cookie", self.cookie.as_str()), ("x-csrf-token", self.csrf.as_str())];
        send(&self.router, request(method, &format!("/api/v1{path}"), body, &headers)).await
    }

    pub async fn get(&self, path: &str) -> Reply {
        self.call("GET", path, None).await
    }

    pub async fn post(&self, path: &str, body: Value) -> Reply {
        self.call("POST", path, Some(body)).await
    }

    pub async fn patch(&self, path: &str, body: Value) -> Reply {
        self.call("PATCH", path, Some(body)).await
    }

    pub async fn put(&self, path: &str, body: Value) -> Reply {
        self.call("PUT", path, Some(body)).await
    }

    pub async fn del(&self, path: &str, body: Option<Value>) -> Reply {
        self.call("DELETE", path, body).await
    }
}

impl Fixture {
    /// Administrator calls: first-run setup (`/api/helpdesk/…`, unauthenticated) or `/api/…` as the
    /// administrator under `/api/v1` (bootstrapping one on first use).
    pub async fn admin(&self, method: &str, path: &str, body: Option<Value>) -> Reply {
        if path.starts_with("/api/helpdesk/") {
            return self.public(request(method, path, body, &[])).await;
        }
        let admin = Box::pin(self.bootstrap()).await;
        admin.call(method, path.trim_start_matches("/api"), body).await
    }

    pub async fn public(&self, request: Request<Body>) -> Reply {
        send(&self.app.public_router(), request).await
    }

    pub async fn api(&self, method: &str, path: &str, body: Option<Value>, headers: &[(&str, &str)]) -> Reply {
        self.public(request(method, &format!("/api/v1{path}"), body, headers))
            .await
    }

    /// Logs in through the API; `Err(status)` when the login is refused.
    pub async fn login(&self, email: &str, password: &str) -> Result<Agent, u16> {
        let body = serde_json::json!({ "email": email, "password": password });
        let reply = self.api("POST", "/auth/login", Some(body), &[]).await;
        if reply.status != 200 {
            return Err(reply.status);
        }
        let cookie = reply.header("set-cookie").unwrap_or_default();
        let cookie = cookie.split(';').next().unwrap_or_default().to_string();
        Ok(Agent {
            router: self.app.public_router(),
            cookie,
            csrf: reply.body["csrf"].as_str().unwrap_or_default().into(),
            user: reply.body["user"].clone(),
        })
    }
}

pub const BOUNDARY: &str = "XBOUNDARYX";

/// A multipart body with text fields and `(field, file name, mime, bytes)` files.
pub fn multipart(fields: &[(&str, &str)], files: &[(&str, &str, &str, &[u8])]) -> Vec<u8> {
    let mut body = Vec::new();
    for (name, value) in fields {
        body.extend(
            format!("--{BOUNDARY}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n").bytes(),
        );
    }
    for (name, file, mime, bytes) in files {
        let head = format!(
            "--{BOUNDARY}\r\nContent-Disposition: form-data; name=\"{name}\"; filename=\"{file}\"\r\nContent-Type: {mime}\r\n\r\n"
        );
        body.extend(head.bytes());
        body.extend_from_slice(bytes);
        body.extend(b"\r\n");
    }
    body.extend(format!("--{BOUNDARY}--\r\n").bytes());
    body
}

/// POSTs a multipart body as the agent.
pub async fn send_multipart(agent: &Agent, path: &str, body: Vec<u8>) -> Reply {
    let request = Request::builder()
        .method("POST")
        .uri(format!("/api/v1{path}"))
        .header("host", "wamcp.test")
        .header("cookie", &agent.cookie)
        .header("x-csrf-token", &agent.csrf)
        .header("content-type", format!("multipart/form-data; boundary={BOUNDARY}"))
        .body(Body::from(body))
        .unwrap();
    send(&agent.router, request).await
}
