//! Standard Webhooks v1 delivery for MCP events: HMAC-SHA256 over `id.timestamp.body`, pinned to
//! the validated IP (no second DNS lookup), no redirects, 10 s deadline and bounded responses.
use super::callback_address::{callback_url, resolve_callback, CallbackUrl};
use crate::application::crypto::{random_secret, same_secret};
use crate::application::ports::{CallbackError, CallbackResponse, EventCallback};
use async_trait::async_trait;
use base64::{engine::general_purpose::STANDARD, Engine};
use hmac::{Hmac, Mac};
use serde_json::{json, Value};
use sha2::Sha256;
use std::time::Duration;

pub const MAX_BODY: usize = 256 * 1024;
pub const MAX_RESPONSE: usize = 64 * 1024;

pub fn error(reason: &str) -> CallbackError {
    CallbackError { reason: reason.into() }
}

fn signing_key(secret: &str) -> Result<Vec<u8>, CallbackError> {
    let encoded = secret
        .strip_prefix("whsec_")
        .filter(|_| secret.len() <= 94)
        .ok_or_else(|| error("invalid_secret"))?;
    let key = STANDARD.decode(encoded).map_err(|_| error("invalid_secret"))?;
    if !(24..=64).contains(&key.len()) || STANDARD.encode(&key) != encoded {
        return Err(error("invalid_secret"));
    }
    Ok(key)
}

/// `v1,<base64 signature>` of the exact `id.timestamp.body` bytes.
pub fn webhook_signature(secret: &str, id: &str, timestamp: &str, body: &str) -> Result<String, CallbackError> {
    let mut mac = Hmac::<Sha256>::new_from_slice(&signing_key(secret)?).map_err(|_| error("invalid_secret"))?;
    mac.update(format!("{id}.{timestamp}.{body}").as_bytes());
    Ok(format!("v1,{}", STANDARD.encode(mac.finalize().into_bytes())))
}

fn identifier(value: &str) -> Result<&str, CallbackError> {
    let valid = !value.is_empty()
        && value.len() <= 256
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_');
    if valid {
        Ok(value)
    } else {
        Err(error("invalid_event"))
    }
}

/// A signed delivery, ready to be posted to the validated callback.
pub struct Prepared {
    pub target: CallbackUrl,
    pub headers: Vec<(&'static str, String)>,
    pub body: String,
}

/// Validates the event and destination, then signs the body with every active secret.
pub fn prepare(
    url: &str,
    subscription: &str,
    secrets: &[String],
    value: &Value,
    id: &str,
    timestamp: &str,
) -> Result<Prepared, CallbackError> {
    let body = value.to_string();
    if body.len() > MAX_BODY {
        return Err(error("payload_too_large"));
    }
    identifier(id)?;
    identifier(subscription)?;
    let signatures = secrets
        .iter()
        .map(|secret| webhook_signature(secret, id, timestamp, &body))
        .collect::<Result<Vec<_>, _>>()?;
    let target = callback_url(url).ok_or_else(|| error("invalid_url"))?;
    let headers = vec![
        ("Content-Type", "application/json".to_string()),
        ("webhook-id", id.to_string()),
        ("webhook-timestamp", timestamp.to_string()),
        ("webhook-signature", signatures.join(" ")),
        ("X-MCP-Subscription-Id", subscription.to_string()),
    ];
    Ok(Prepared { target, headers, body })
}

/// The subscriber must answer 2xx with `{ "challenge": <the challenge we sent> }`.
pub fn accepts_challenge(response: &CallbackResponse, challenge: &str) -> bool {
    let echo = serde_json::from_str::<Value>(&response.body).ok();
    let echoed = echo.as_ref().and_then(|v| v["challenge"].as_str());
    (200..300).contains(&response.status) && echoed.is_some_and(|e| same_secret(e, challenge))
}

#[derive(Default)]
pub struct HttpEventCallback;

impl HttpEventCallback {
    async fn post(&self, prepared: Prepared) -> Result<CallbackResponse, CallbackError> {
        let target = prepared.target;
        let address = resolve_callback(&target).await.ok_or_else(|| error("invalid_url"))?;
        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .no_proxy()
            .https_only(true)
            .resolve(&target.host, address)
            .build()
            .map_err(|_| error("delivery_failed"))?;
        let mut request = client.post(target.url.clone()).body(prepared.body);
        for (name, value) in prepared.headers {
            request = request.header(name, value);
        }
        let mut response = request.send().await.map_err(|_| error("delivery_failed"))?;
        let status = response.status().as_u16();
        // Error bodies are never consumed; success bodies are bounded.
        if !(200..300).contains(&status) {
            return Ok(CallbackResponse {
                status,
                body: String::new(),
            });
        }
        if response.content_length().is_some_and(|l| l as usize > MAX_RESPONSE) {
            return Err(error("delivery_failed"));
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(|_| error("delivery_failed"))? {
            bytes.extend_from_slice(&chunk);
            if bytes.len() > MAX_RESPONSE {
                return Err(error("delivery_failed"));
            }
        }
        Ok(CallbackResponse {
            status,
            body: String::from_utf8_lossy(&bytes).into_owned(),
        })
    }

    async fn send(
        &self,
        url: &str,
        subscription: &str,
        secrets: &[String],
        value: &Value,
        id: &str,
    ) -> Result<CallbackResponse, CallbackError> {
        let timestamp = chrono::Utc::now().timestamp().to_string();
        let prepared = prepare(url, subscription, secrets, value, id, &timestamp)?;
        // A wall-clock deadline covers DNS, connect, TLS, headers and the full response.
        tokio::time::timeout(Duration::from_secs(10), self.post(prepared))
            .await
            .map_err(|_| error("timeout"))?
    }
}

#[async_trait]
impl EventCallback for HttpEventCallback {
    async fn verify(&self, url: &str, subscription: &str, secret: &str) -> Result<(), CallbackError> {
        let challenge = random_secret();
        let id = format!("msg_{}", uuid::Uuid::new_v4().simple());
        let payload = json!({ "type": "verification", "challenge": challenge });
        let response = self
            .send(url, subscription, &[secret.to_string()], &payload, &id)
            .await
            .map_err(|e| {
                let known = e.reason == "invalid_url" || e.reason == "timeout";
                error(if known { &e.reason } else { "challenge_failed" })
            })?;
        if accepts_challenge(&response, &challenge) {
            Ok(())
        } else {
            Err(error("challenge_failed"))
        }
    }

    async fn deliver(
        &self,
        url: &str,
        subscription: &str,
        secrets: &[String],
        event: &Value,
    ) -> Result<CallbackResponse, CallbackError> {
        let id = event["eventId"].as_str().unwrap_or_default().to_string();
        self.send(url, subscription, secrets, event, &id).await
    }
}
