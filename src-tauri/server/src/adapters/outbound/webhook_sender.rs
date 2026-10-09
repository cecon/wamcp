//! Delivers helpdesk webhooks like Chatwoot: JSON body signed with HMAC-SHA256 of
//! "<timestamp>.<body>" in X-Wamcp-Signature, so receivers can verify origin and reject replays.
use crate::application::crypto::{base64url, random_bytes};
use crate::application::ports::{SendFailure, WebhookSender};
use async_trait::async_trait;
use hmac::{Hmac, Mac};
use serde_json::Value;
use sha2::Sha256;
use std::time::Duration;

pub fn signature(secret: &str, timestamp: &str, body: &str) -> String {
    let mut mac = Hmac::<Sha256>::new_from_slice(secret.as_bytes()).expect("HMAC accepts any key length");
    mac.update(format!("{timestamp}.{body}").as_bytes());
    hex::encode(mac.finalize().into_bytes())
}

pub struct HttpWebhookSender {
    client: reqwest::Client,
}

impl HttpWebhookSender {
    pub fn new() -> Self {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(10))
            .redirect(reqwest::redirect::Policy::none())
            .user_agent("wamcp-webhooks")
            .build()
            .unwrap_or_default();
        Self { client }
    }
}

impl Default for HttpWebhookSender {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl WebhookSender for HttpWebhookSender {
    fn secret(&self) -> String {
        base64url(&random_bytes(24))
    }

    async fn post(&self, url: &str, body: &Value, secret: &str) -> Result<u16, SendFailure> {
        let raw = body.to_string();
        let timestamp = chrono::Utc::now().timestamp().to_string();
        let response = self
            .client
            .post(url)
            .header("Content-Type", "application/json")
            .header("X-Wamcp-Event", body["event"].as_str().unwrap_or_default())
            .header("X-Wamcp-Timestamp", &timestamp)
            .header(
                "X-Wamcp-Signature",
                format!("sha256={}", signature(secret, &timestamp, &raw)),
            )
            .body(raw)
            .send()
            .await
            .map_err(|e| {
                if e.is_timeout() {
                    SendFailure::Timeout
                } else {
                    SendFailure::Connection
                }
            })?;
        Ok(response.status().as_u16())
    }
}
