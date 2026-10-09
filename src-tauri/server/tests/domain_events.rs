//! MCP events extension: every validation message of the subscription parameters and owners.
use serde_json::{json, Value};
use wamcp_server::domain::events::*;

/// `whsec_` + base64 of `bytes` zero bytes.
fn secret(bytes: usize) -> String {
    use base64::Engine;
    format!(
        "whsec_{}",
        base64::engine::general_purpose::STANDARD.encode(vec![0u8; bytes])
    )
}

fn params(delivery: Value) -> Value {
    json!({ "name": EVENT_NAME, "delivery": delivery })
}

fn webhook(url: &str) -> Value {
    json!({ "mode": "webhook", "url": url, "secret": secret(32) })
}

fn error(params: &Value, subscribing: bool) -> String {
    match event_parameters(params, subscribing) {
        Err(e) => {
            assert_eq!(e.code, -32602);
            assert_eq!(e.reason, None);
            e.message
        }
        Ok(p) => panic!("expected an error, got {p:?}"),
    }
}

#[test]
fn subscriptions_require_the_supported_event_and_filter() {
    let ok = webhook("https://example.com/cb");
    assert_eq!(error(&json!([]), true), "Evento não suportado");
    assert_eq!(
        error(&json!({ "name": "other", "delivery": ok }), true),
        "Evento não suportado"
    );
    assert_eq!(error(&json!({ "delivery": ok }), true), "Evento não suportado");
    let with_args = |args: Value| json!({ "name": EVENT_NAME, "arguments": args, "delivery": ok });
    assert_eq!(error(&with_args(json!([])), true), "Argumentos de evento inválidos");
    assert_eq!(error(&with_args(Value::Null), true), "Argumentos de evento inválidos");
    assert_eq!(
        error(&with_args(json!({ "other": 1 })), true),
        "Argumentos de evento inválidos"
    );
    assert_eq!(error(&with_args(json!({ "jid": 5 })), true), "Conversa inválida");
    assert_eq!(
        error(&with_args(json!({ "jid": "abc@s.whatsapp.net" })), true),
        "Conversa inválida"
    );
    assert_eq!(
        error(&with_args(json!({ "jid": "1@broadcast" })), true),
        "Conversa inválida"
    );
    let long = format!("{}@s.whatsapp.net", "1".repeat(190));
    assert_eq!(error(&with_args(json!({ "jid": long })), true), "Conversa inválida");
    for jid in ["5511999999999@s.whatsapp.net", "120363:1@g.us", "123.4_5-6@lid"] {
        let parsed = event_parameters(&with_args(json!({ "jid": jid })), true).expect(jid);
        assert_eq!(parsed.args.get("jid"), Some(&json!(jid)));
    }
    assert!(event_parameters(&with_args(json!({})), true)
        .expect("empty filter")
        .args
        .is_empty());
}

#[test]
fn delivery_must_be_an_https_webhook_without_credentials() {
    let invalid = "Entrega webhook inválida";
    assert_eq!(error(&json!({ "name": EVENT_NAME }), true), invalid);
    assert_eq!(error(&params(json!("https://example.com")), true), invalid);
    assert_eq!(
        error(&params(json!({ "mode": "push", "url": "https://example.com" })), true),
        invalid
    );
    assert_eq!(error(&params(json!({ "mode": "webhook", "url": 5 })), true), invalid);
    assert_eq!(error(&params(json!({ "mode": "webhook" })), true), invalid);
    let long = format!("https://example.com/{}", "a".repeat(2049 - 20));
    assert_eq!(long.len(), 2049);
    assert_eq!(error(&params(webhook(&long)), true), invalid);
    let fits = format!("https://example.com/{}", "a".repeat(2048 - 20));
    assert!(event_parameters(&params(webhook(&fits)), true).is_ok());
    assert_eq!(error(&params(webhook("not a url")), true), "URL de callback inválida");
    let insecure = "Callback deve usar HTTPS sem credenciais ou fragmento";
    for url in [
        "http://example.com/cb",
        "https://u@example.com/cb",
        "https://u:p@example.com",
        "https://e.com/#x",
    ] {
        assert_eq!(error(&params(webhook(url)), true), insecure, "{url}");
    }
}

#[test]
fn unsubscribing_needs_no_secret_and_normalizes_the_url() {
    let p = params(json!({ "mode": "webhook", "url": "https://Example.com" }));
    let parsed = event_parameters(&p, false).expect("unsubscribe");
    assert_eq!(parsed.url, "https://example.com/");
    assert_eq!((parsed.secret, parsed.ttl), (None, None));
    assert!(parsed.args.is_empty());
    let with_query = params(webhook("https://example.com/cb?a=1"));
    assert_eq!(
        event_parameters(&with_query, true).expect("query").url,
        "https://example.com/cb?a=1"
    );
}

#[test]
fn subscribing_validates_secret_cursor_and_ttl() {
    let bad_secret = "Segredo de assinatura inválido";
    let with = |secret: Value| params(json!({ "mode": "webhook", "url": "https://e.com", "secret": secret }));
    assert_eq!(error(&with(Value::Null), true), bad_secret);
    assert_eq!(
        error(&params(json!({ "mode": "webhook", "url": "https://e.com" })), true),
        bad_secret
    );
    assert_eq!(error(&with(json!("abc")), true), bad_secret);
    assert_eq!(error(&with(json!("whsec_A")), true), bad_secret, "not base64");
    assert_eq!(
        error(&with(json!("whsec_AAB=")), true),
        bad_secret,
        "non-canonical padding bits"
    );
    assert_eq!(
        error(&with(json!(format!("{}A", secret(64)))), true),
        bad_secret,
        "longer than 94"
    );
    for bytes in [24, 64] {
        let parsed = event_parameters(&with(json!(secret(bytes))), true).expect("secret size");
        assert_eq!(parsed.secret, Some(secret(bytes)));
    }

    let full = |extra: Value| {
        let mut p = params(webhook("https://e.com/cb"));
        p.as_object_mut()
            .expect("object")
            .extend(extra.as_object().expect("extra").clone());
        p
    };
    assert_eq!(
        error(&full(json!({ "cursor": "c1" })), true),
        "Este evento não oferece replay; cursor deve ser null"
    );
    assert!(event_parameters(&full(json!({ "cursor": null })), true).is_ok());
    let ttl = |value: Value| event_parameters(&full(json!({ "ttlMs": value })), true).map(|p| p.ttl);
    assert_eq!(ttl(Value::Null), Ok(Some(EVENT_TTL)));
    assert_eq!(
        event_parameters(&full(json!({})), true).map(|p| p.ttl),
        Ok(Some(EVENT_TTL))
    );
    assert_eq!(ttl(json!(1000)), Ok(Some(1000)));
    assert_eq!(ttl(json!(EVENT_TTL * 2)), Ok(Some(EVENT_TTL)), "capped at 24h");
    assert_eq!(ttl(json!(9_007_199_254_740_991_i64)), Ok(Some(EVENT_TTL)));
    let bad_ttl = "ttlMs deve ser um inteiro positivo ou null";
    for value in [
        json!(0),
        json!(-1),
        json!("10"),
        json!(1.5),
        json!(9_007_199_254_740_992_i64),
    ] {
        assert_eq!(error(&full(json!({ "ttlMs": value })), true), bad_ttl, "{value}");
    }
    assert!(
        event_parameters(&full(json!({ "cursor": "c", "ttlMs": 0 })), false).is_ok(),
        "only checked on subscribe"
    );
}

#[test]

fn secrets_with_the_wrong_size_explain_the_range() {
    let range = "Segredo de assinatura deve conter 24–64 bytes";
    assert_eq!(
        error(
            &params(json!({ "mode": "webhook", "url": "https://e.com", "secret": secret(23) })),
            true
        ),
        range
    );
    assert_eq!(
        error(
            &params(json!({ "mode": "webhook", "url": "https://e.com", "secret": secret(65) })),
            true
        ),
        range
    );
}

fn owner(kind: &str, session: &str, principal: &str) -> EventOwner {
    EventOwner {
        session_id: session.into(),
        principal_id: principal.into(),
        principal_kind: kind.into(),
    }
}

#[test]
fn owners_identities_and_errors() {
    assert!(validate_owner(&owner("token", "s", "p")).is_ok());
    assert!(validate_owner(&owner("oauth", &"s".repeat(200), &"p".repeat(200))).is_ok());
    let long = "s".repeat(201);
    for bad in [
        owner("user", "s", "p"),
        owner("token", "", "p"),
        owner("oauth", "s", ""),
        owner("token", &long, "p"),
    ] {
        let e = validate_owner(&bad).expect_err("invalid owner");
        assert_eq!((e.code, e.message.as_str()), (-32001, "Identidade de evento inválida"));
    }
    let parsed = event_parameters(&params(webhook("https://e.com/cb")), true).expect("params");
    let identity = subscription_identity(&owner("token", "s", "p"), &parsed);
    assert_eq!(identity, r#"["s","token","p","https://e.com/cb","message.created",{}]"#);
    let callback = EventError::callback("timeout");
    assert_eq!((callback.code, callback.reason.as_deref()), (-32015, Some("timeout")));
    assert_eq!(callback.message, "Falha ao verificar callback");
    assert_eq!(EventError::new("x"), EventError::coded("x", -32602));
    assert_eq!(
        (ROTATION_WINDOW, EVENT_TTL, MAX_EVENT_TEXT),
        (300_000, 86_400_000, 8000)
    );
}
