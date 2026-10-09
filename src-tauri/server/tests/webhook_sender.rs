//! Port of tests/helpdesk-rules.test.mjs: the helpdesk webhook sender and its HMAC signature.
use serde_json::{json, Value};
use wamcp_server::adapters::outbound::webhook_sender::{signature, HttpWebhookSender};
use wamcp_server::application::ports::WebhookSender;

/// A one-shot HTTP server answering `status` (plus `extra` headers); returns the raw request text.
async fn serve_once(status: &str, extra: &str) -> (String, tokio::task::JoinHandle<String>) {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.expect("bind");
    let url = format!("http://{}/h", listener.local_addr().expect("addr"));
    let reply = format!("HTTP/1.1 {status}\r\ncontent-length: 0\r\nconnection: close\r\n{extra}\r\n");
    let handle = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.expect("accept");
        let mut raw = Vec::new();
        let mut buffer = [0u8; 4096];
        loop {
            let read = socket.read(&mut buffer).await.expect("read");
            raw.extend_from_slice(&buffer[..read]);
            let text = String::from_utf8_lossy(&raw).to_string();
            if let Some(end) = text.find("\r\n\r\n") {
                let length = header_in(&text, "content-length")
                    .and_then(|v| v.parse().ok())
                    .unwrap_or(0);
                if raw.len() >= end + 4 + length || read == 0 {
                    break;
                }
            }
            if read == 0 {
                break;
            }
        }
        socket.write_all(reply.as_bytes()).await.expect("write");
        String::from_utf8_lossy(&raw).to_string()
    });
    (url, handle)
}

fn header_in(raw: &str, name: &str) -> Option<String> {
    raw.lines()
        .find_map(|line| line.split_once(':').filter(|(k, _)| k.eq_ignore_ascii_case(name)))
        .map(|(_, v)| v.trim().to_string())
}

#[tokio::test]
async fn webhook_sender_signs_timestamp_and_body_with_hmac_sha256() {
    let sender = HttpWebhookSender::new();
    let (url, server) = serve_once("204 No Content", "").await;
    let body = json!({ "event": "message_created", "a": 1 });
    assert_eq!(sender.post(&url, &body, "s3cret").await, Ok(204));
    let raw = server.await.expect("server");
    let timestamp = header_in(&raw, "x-wamcp-timestamp").expect("timestamp");
    let sent_body = raw
        .split_once("\r\n\r\n")
        .map(|(_, b)| b.to_string())
        .unwrap_or_default();
    assert_eq!(serde_json::from_str::<Value>(&sent_body).expect("json body"), body);
    let expected = format!("sha256={}", signature("s3cret", &timestamp, &sent_body));
    assert_eq!(header_in(&raw, "x-wamcp-signature"), Some(expected));
    assert_eq!(header_in(&raw, "x-wamcp-event").as_deref(), Some("message_created"));
    assert_eq!(header_in(&raw, "content-type").as_deref(), Some("application/json"));
    let secret = sender.secret();
    assert_eq!(secret.len(), 32);
    assert!(
        secret
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-'),
        "{secret}"
    );

    let (redirecting, server) = serve_once("302 Found", "location: https://example.com/elsewhere\r\n").await;
    assert_eq!(
        sender.post(&redirecting, &json!({ "event": "x" }), "s").await,
        Ok(302),
        "redirects not followed"
    );
    server.await.expect("server");
    let (failing, server) = serve_once("500 Internal Server Error", "").await;
    assert_eq!(sender.post(&failing, &json!({ "event": "x" }), "s").await, Ok(500));
    server.await.expect("server");
}

#[test]
fn webhook_signature_is_the_hex_hmac_of_timestamp_dot_body() {
    use hmac::{Hmac, Mac};
    let mut mac = Hmac::<sha2::Sha256>::new_from_slice(b"s3cret").expect("key");
    mac.update(br#"1700000000.{"a":1}"#);
    assert_eq!(
        signature("s3cret", "1700000000", r#"{"a":1}"#),
        hex::encode(mac.finalize().into_bytes())
    );
    assert_ne!(signature("s3cret", "1", "x"), signature("other", "1", "x"));
}
