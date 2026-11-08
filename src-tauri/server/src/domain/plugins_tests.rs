use super::*;
use serde_json::json;

fn manifest(url: &str, kind: &str) -> Value {
    json!({
        "id": "delivery", "name": "Delivery", "version": "0.1.0",
        "skills": [{ "name": "Anotar pedido", "instructions": "Confirme itens e endereço." }],
        "credentials": [{ "name": "erp_token", "help": "Token do ERP" }],
        "tools": [{ "name": "criar_pedido", "description": "Cria o pedido no ERP.", "side_effects": true,
                    "endpoint": { "kind": kind, "url": url, "credential": "erp_token" } }]
    })
}

#[test]
fn a_valid_manifest_names_its_tools_and_skills() {
    let m = parse(&manifest("https://erp.exemplo.com/mcp", "mcp"), false).unwrap();
    assert_eq!(m.tool_name(&m.tools[0]), "delivery.criar_pedido");
    assert_eq!(m.skill_name(&m.skills[0]), "Delivery: Anotar pedido");
    assert!(m.tools[0].side_effects && !m.tools[0].internal_only);
}

#[test]
fn plain_http_is_only_for_this_computer() {
    assert!(parse(&manifest("http://127.0.0.1:8080/x", "http"), false).is_ok());
    assert!(parse(&manifest("http://localhost/x", "http"), false).is_ok());
    assert!(parse(&manifest("http://localhost.evil.com/x", "http"), false).is_err());
    assert!(parse(&manifest("http://erp.exemplo.com/x", "http"), false).is_err());
}

#[test]
fn builtin_endpoints_and_undeclared_credentials_are_refused() {
    assert!(parse(&manifest("", "builtin"), false).is_err());
    assert!(parse(&manifest("", "builtin"), true).is_ok());
    let mut bad = manifest("https://a.com", "http");
    bad["tools"][0]["endpoint"]["credential"] = json!("outra");
    assert!(parse(&bad, false).is_err());
    let mut id = manifest("https://a.com", "http");
    id["id"] = json!("Com Espaço");
    assert!(parse(&id, false).is_err());
}

#[test]
fn versions_compare_by_number() {
    assert_eq!(version("1.10.0"), Some((1, 10, 0)));
    assert!(version("1.10.0") > version("1.9.3"));
    assert_eq!(version("2.0.0-beta"), Some((2, 0, 0)));
    assert_eq!(version("1.0"), None);
    assert_eq!(version("1.0.0.1"), None);
    assert_eq!(version("v1.0.0"), None);
}
