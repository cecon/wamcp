//! In-process HTTP calls against the admin and public routers (no sockets).
use super::{Fixture, ADMIN_TOKEN};
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
    let bytes = response.into_body().collect().await.map(|b| b.to_bytes()).unwrap_or_default();
    let text = String::from_utf8_lossy(&bytes).into_owned();
    let body = serde_json::from_str(&text).unwrap_or(Value::Null);
    Reply { status, headers, body, text }
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
    pub async fn admin(&self, method: &str, path: &str, body: Option<Value>) -> Reply {
        let auth = format!("Bearer {ADMIN_TOKEN}");
        send(&self.app.admin_router(), request(method, path, body, &[("authorization", &auth)])).await
    }

    pub async fn public(&self, request: Request<Body>) -> Reply {
        send(&self.app.public_router(), request).await
    }

    pub async fn api(&self, method: &str, path: &str, body: Option<Value>, headers: &[(&str, &str)]) -> Reply {
        self.public(request(method, &format!("/api/v1{path}"), body, headers)).await
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
