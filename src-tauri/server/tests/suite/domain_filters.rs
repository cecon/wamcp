//! Custom attribute keys and typed values.
use serde_json::json;
use wamcp_server::domain::filters::{attribute_key, attribute_kind, validate_value};

#[test]
fn keys_are_normalised() {
    assert_eq!(attribute_key("Plano Contratado", None).unwrap(), "plano_contratado");
    assert_eq!(attribute_key("x", Some(" Meu-Campo ")).unwrap(), "meu_campo");
    assert!(attribute_key("***", None).is_err());
    assert!(attribute_key(&"a".repeat(61), None).is_err());
}

#[test]
fn values_follow_their_display_type() {
    let options = vec!["a".to_string()];
    let valid = [
        ("number", json!(3)),
        ("percent", json!(1.5)),
        ("checkbox", json!(true)),
        ("date", json!("2026-10-06")),
        ("date", json!("2026-10-06T10:00:00Z")),
        ("link", json!("https://cappyfy.com")),
        ("list", json!("a")),
        ("text", json!("livre")),
        ("text", json!(null)),
    ];
    for (kind, value) in valid {
        assert!(validate_value(kind, &options, None, &value).is_ok(), "{kind} {value}");
    }
    let invalid = [
        ("number", json!("3")),
        ("checkbox", json!("sim")),
        ("date", json!("06/10/2026")),
        ("link", json!("ftp://x")),
        ("link", json!("nada")),
        ("list", json!("b")),
        ("text", json!(5)),
        ("text", json!("x".repeat(1001))),
    ];
    for (kind, value) in invalid {
        assert!(validate_value(kind, &options, None, &value).is_err(), "{kind} {value}");
    }
    assert!(validate_value("text", &[], Some(r"^\d+$"), &json!("123")).is_ok());
    assert!(validate_value("text", &[], Some(r"^\d+$"), &json!("12a")).is_err());
}

#[test]
fn filter_kinds_cover_builtins_and_custom_attributes() {
    let custom = vec![
        ("valor".to_string(), "currency".to_string()),
        ("vence".to_string(), "date".to_string()),
        ("ativo".to_string(), "checkbox".to_string()),
        ("site".to_string(), "link".to_string()),
    ];
    assert_eq!(attribute_kind("contact", "email", &custom), Some("text"));
    assert_eq!(attribute_kind("contact", "status", &custom), None);
    assert_eq!(
        attribute_kind("conversation", "custom_attribute:valor", &custom),
        Some("number")
    );
    assert_eq!(
        attribute_kind("conversation", "custom_attribute:vence", &custom),
        Some("date")
    );
    assert_eq!(
        attribute_kind("conversation", "custom_attribute:ativo", &custom),
        Some("boolean")
    );
    assert_eq!(
        attribute_kind("conversation", "custom_attribute:site", &custom),
        Some("text")
    );
    assert_eq!(attribute_kind("conversation", "valor", &custom), None);
}
