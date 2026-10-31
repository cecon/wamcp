//! A connected GitHub channel and the webhook deliveries the tests send to it.
use crate::common::{self, Fixture};
use axum::body::Body;
use axum::http::Request;
use hmac::{Hmac, Mac};
use serde_json::{json, Value};
use sha2::Sha256;

pub const REPO: &str = "cecon/wamcp";

pub struct Channel {
    pub f: Fixture,
    pub admin: common::Agent,
    pub inbox: i64,
    pub secret: String,
}

pub async fn connected() -> Channel {
    let f = Fixture::new().await;
    let admin = f.bootstrap().await;
    let reply = admin
        .post(
            "/github_channels",
            json!({ "name": "wamcp no GitHub", "repo": REPO, "token": "ghp_teste" }),
        )
        .await;
    assert_eq!(reply.status, 201, "{:?}", reply.body);
    let inbox = reply.body["inbox"]["id"].as_i64().unwrap();
    let secret = reply.body["webhook_secret"].as_str().unwrap().to_string();
    Channel {
        f,
        admin,
        inbox,
        secret,
    }
}

fn signature(secret: &str, body: &[u8]) -> String {
    let mut mac = Hmac::<Sha256>::new_from_slice(secret.as_bytes()).unwrap();
    mac.update(body);
    format!("sha256={}", hex::encode(mac.finalize().into_bytes()))
}

pub fn repository() -> Value {
    json!({ "full_name": REPO, "default_branch": "main", "html_url": format!("https://github.com/{REPO}") })
}

pub fn pr_opened(number: u64) -> Value {
    json!({ "action": "opened", "sender": { "login": "maria" }, "repository": repository(),
            "pull_request": { "number": number, "title": "Corrige login", "body": "Troca o token de lugar.",
                              "html_url": format!("https://github.com/{REPO}/pull/{number}"),
                              "head": { "ref": "fix/login" }, "base": { "ref": "main" } } })
}

impl Channel {
    pub async fn deliver(&self, event: &str, delivery: &str, payload: &Value, secret: Option<&str>) -> u16 {
        let body = serde_json::to_vec(payload).unwrap();
        let signed = signature(secret.unwrap_or(&self.secret), &body);
        let request = Request::post(format!("/api/github/{}/webhook", self.inbox))
            .header("content-type", "application/json")
            .header("x-github-event", event)
            .header("x-github-delivery", delivery)
            .header("x-hub-signature-256", signed)
            .body(Body::from(body))
            .unwrap();
        let status = self.f.public(request).await.status;
        self.f.settle().await;
        status
    }

    pub async fn conversations(&self) -> Vec<Value> {
        let list = self
            .admin
            .get(&format!("/conversations?inbox_id={}&status=all", self.inbox))
            .await;
        list.body.as_array().cloned().unwrap_or_default()
    }

    pub async fn messages(&self, display_id: &Value) -> Vec<String> {
        let list = self
            .admin
            .get(&format!("/conversations/{display_id}/messages"))
            .await
            .body;
        list.as_array()
            .unwrap()
            .iter()
            .filter_map(|m| m["content"].as_str().map(String::from))
            .collect()
    }
}
