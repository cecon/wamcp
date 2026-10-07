//! Constants and helpers shared by the MCP event callback tests.
#![allow(dead_code)]
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};
use wamcp_server::adapters::outbound::event_callback::Prepared;
use wamcp_server::application::ports::CallbackError;

pub const URL: &str = "https://receiver.example.com:8443/callback?key=opaque";
pub const SUBSCRIPTION: &str = "sub_test";

pub fn secret(fill: u8, length: usize) -> String {
    format!("whsec_{}", STANDARD.encode(vec![fill; length]))
}

pub fn event() -> Value {
    json!({ "eventId": "evt_test", "name": "message.created", "data": { "text": "Olá 👋" } })
}

/// The rejection reason of a `prepare` call, or `accepted`.
pub fn reason(result: Result<Prepared, CallbackError>) -> String {
    result.err().map(|e| e.reason).unwrap_or_else(|| "accepted".into())
}
