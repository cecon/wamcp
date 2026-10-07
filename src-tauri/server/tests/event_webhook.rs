//! MCP event callbacks (ports of tests/event-webhook*.test.mjs): Standard Webhooks signatures,
//! challenge checks and payload limits. Destination validation lives in `event_webhook_destinations.rs`.
mod event_webhook_support;

use base64::{engine::general_purpose::STANDARD, Engine};
use event_webhook_support::{event, reason, secret, SUBSCRIPTION, URL};
use hmac::{Hmac, Mac};
use serde_json::{json, Value};
use sha2::Sha256;
use wamcp_server::adapters::outbound::event_callback::{
    accepts_challenge, prepare, webhook_signature, HttpEventCallback, Prepared,
};
use wamcp_server::application::ports::{CallbackResponse, EventCallback};

fn header<'a>(prepared: &'a Prepared, name: &str) -> &'a str {
    prepared
        .headers
        .iter()
        .find(|(n, _)| *n == name)
        .map(|(_, v)| v.as_str())
        .unwrap_or_default()
}

/// Recomputes the HMAC independently and checks it is one of the space-separated signatures.
fn check_signature(prepared: &Prepared, secret: &str) -> String {
    let key = STANDARD.decode(&secret[6..]).expect("key");
    let mut mac = Hmac::<Sha256>::new_from_slice(&key).expect("hmac");
    let (id, timestamp) = (header(prepared, "webhook-id"), header(prepared, "webhook-timestamp"));
    let signed = format!("{id}.{timestamp}.{}", prepared.body);
    mac.update(signed.as_bytes());
    let signature = STANDARD.encode(mac.finalize().into_bytes());
    assert!(header(prepared, "webhook-signature")
        .split(' ')
        .any(|s| s == format!("v1,{signature}")));
    signature
}

fn prepared(secrets: &[String], value: &Value, timestamp: &str) -> Prepared {
    let id = value["eventId"].as_str().unwrap_or_default();
    prepare(URL, SUBSCRIPTION, secrets, value, id, timestamp).unwrap_or_else(|e| panic!("prepare: {}", e.reason))
}

#[test]
fn standard_webhooks_official_signing_test_vector() {
    let signature = webhook_signature(
        "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw",
        "msg_p5jXN8AQM9LWM0D4loKWxJek",
        "1614265330",
        r#"{"test": 2432232314}"#,
    );
    assert_eq!(
        signature.expect("signature"),
        "v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE="
    );
}

#[test]
fn delivery_serializes_once_and_signs_exact_utf8_bytes_with_matching_event_id() {
    let request = prepared(&[secret(7, 32)], &event(), "1700000000");
    assert_eq!(request.body, event().to_string());
    assert_eq!(header(&request, "webhook-id"), "evt_test");
    assert_eq!(header(&request, "Content-Type"), "application/json");
    assert_eq!(header(&request, "X-MCP-Subscription-Id"), SUBSCRIPTION);
    assert_eq!(request.target.host, "receiver.example.com");
    check_signature(&request, &secret(7, 32));
}

#[test]
fn retries_preserve_event_id_and_body_but_regenerate_signing_time_and_signature() {
    let first = prepared(&[secret(7, 32)], &event(), "1700000000");
    let second = prepared(&[secret(7, 32)], &event(), "1700000003");
    assert_eq!(first.body, second.body);
    assert_eq!(header(&first, "webhook-id"), header(&second, "webhook-id"));
    assert_ne!(
        header(&first, "webhook-timestamp"),
        header(&second, "webhook-timestamp")
    );
    assert_ne!(
        check_signature(&first, &secret(7, 32)),
        check_signature(&second, &secret(7, 32))
    );
}

#[test]
fn rotation_signs_with_every_active_secret() {
    let (current, previous) = (secret(7, 32), secret(9, 24));
    let both = prepared(&[current.clone(), previous.clone()], &event(), "1700000000");
    assert_eq!(header(&both, "webhook-signature").split(' ').count(), 2);
    check_signature(&both, &current);
    check_signature(&both, &previous);
    let single = prepared(&[current], &event(), "1700000000");
    assert_eq!(header(&single, "webhook-signature").split(' ').count(), 1);
}

#[test]
fn verification_rejects_mismatched_malformed_missing_non_string_and_non_2xx_echoes() {
    let challenge = "c".repeat(43);
    let answer = |status: u16, body: &str| CallbackResponse {
        status,
        body: body.into(),
    };
    let good = json!({ "challenge": challenge }).to_string();
    assert!(accepts_challenge(&answer(200, &good), &challenge));
    let wrong = json!({ "challenge": "x".repeat(43) }).to_string();
    for body in [
        "{}",
        "{",
        "null",
        r#"{"challenge":1}"#,
        r#"{"challenge":"wrong"}"#,
        wrong.as_str(),
        "",
    ] {
        assert!(!accepts_challenge(&answer(200, body), &challenge), "{body}");
    }
    for status in [301, 302, 307, 308, 400, 500] {
        assert!(!accepts_challenge(&answer(status, &good), &challenge), "{status}");
    }
}

#[test]
fn payload_limit_is_measured_in_utf8_bytes_and_accepts_exactly_256_kib() {
    let mut payload = json!({ "eventId": "evt_limit", "text": "" });
    let remaining = 262_144 - payload.to_string().len();
    payload["text"] = json!("x".repeat(remaining));
    let accepted = prepared(&[secret(7, 32)], &payload, "1700000000");
    assert_eq!(accepted.body.len(), 262_144);
    payload["text"] = json!("x".repeat(remaining + 1));
    let one_more = prepare(URL, SUBSCRIPTION, &[secret(7, 32)], &payload, "evt_limit", "1");
    assert_eq!(reason(one_more), "payload_too_large");
    payload["text"] = json!("é".repeat(140_000));
    let multibyte = prepare(URL, SUBSCRIPTION, &[secret(7, 32)], &payload, "evt_limit", "1");
    assert_eq!(reason(multibyte), "payload_too_large");
}

#[test]
fn invalid_secrets_and_event_ids_never_create_a_request() {
    let invalid = [
        "raw".to_string(),
        "whsec_".into(),
        "whsec_!!!!".into(),
        secret(0, 23),
        secret(0, 65),
    ];
    for bad in invalid {
        let result = prepare(URL, SUBSCRIPTION, std::slice::from_ref(&bad), &event(), "evt_test", "1");
        assert_eq!(reason(result), "invalid_secret", "{bad}");
    }
    let long = "x".repeat(257);
    for id in ["", "invalid.id", "x\r\ny", long.as_str()] {
        let result = prepare(URL, SUBSCRIPTION, &[secret(7, 32)], &event(), id, "1");
        assert_eq!(reason(result), "invalid_event", "{id:?}");
    }
}

#[tokio::test]
async fn deliveries_without_a_valid_event_id_fail_before_any_network_call() {
    let callback = HttpEventCallback;
    for body in [Value::Null, json!({ "eventId": "invalid.id" }), json!({ "data": 1 })] {
        let error = callback
            .deliver(URL, SUBSCRIPTION, &[secret(7, 32)], &body)
            .await
            .expect_err("invalid");
        assert_eq!(error.reason, "invalid_event", "{body}");
    }
}
