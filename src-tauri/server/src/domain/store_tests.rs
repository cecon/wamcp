use super::*;
use crate::domain::plugins::parse;
use serde_json::json;

const BASE: &str = "https://example.org/wamcp/plugins/catalog.json";

fn catalog() -> Value {
    json!({
        "name": "Loja",
        "plugins": [{"id": "contador", "name": "Contador", "version": "1.0.0",
                     "url": "contador/plugin.json", "docs": "contador/README.md"}],
        "agents": [{"id": "contador", "name": "Contador", "version": "1.0.0", "plugin": "contador",
                    "agent_name": "Cora", "instructions": "Atenda os clientes.",
                    "goals": ["Nenhum documento atrasado"],
                    "tools": [{"tool": "contador.prazos"}, {"tool": "mensagens.enviar_whatsapp", "effect": "approval"}],
                    "schedules": ["Lembrar prazos"]}]
    })
}

#[test]
fn relative_addresses_resolve_against_the_catalog_and_defaults_apply() {
    let parsed = parse_catalog(&catalog(), BASE).unwrap();
    let plugin = &parsed.plugins[0];
    assert_eq!(plugin.url, "https://example.org/wamcp/plugins/contador/plugin.json");
    assert_eq!(
        plugin.docs.as_deref(),
        Some("https://example.org/wamcp/plugins/contador/README.md")
    );
    let template = parsed.agent("contador").unwrap();
    assert_eq!(
        (template.role.as_str(), template.runtime.as_str()),
        ("operator", "opencode")
    );
    assert_eq!(template.tools[0].effect, "allow");
    assert_eq!(
        template.agent_instructions(),
        "Atenda os clientes.\n\n## Objetivos\n- Nenhum documento atrasado"
    );
}

#[test]
fn bad_catalogs_are_refused_with_the_reason() {
    let cases: [(&str, Value, &str); 6] = [
        ("/plugins/0/url", json!("http://example.org/p.json"), "use HTTPS"),
        ("/plugins/0/version", json!("1.0"), "versão"),
        ("/agents/0/plugin", json!("outro"), "não está na loja"),
        ("/agents/0/role", json!("coordinator"), "precisa executar"),
        ("/agents/0/runtime", json!("chatgpt"), "runtime desconhecido"),
        ("/agents/0/tools/0/effect", json!("sempre"), "allow ou approval"),
    ];
    for (pointer, value, reason) in cases {
        let mut json = catalog();
        let (parent, key) = pointer.rsplit_once('/').unwrap();
        json.pointer_mut(parent).unwrap()[key] = value;
        let error = parse_catalog(&json, BASE).unwrap_err().to_string();
        assert!(error.contains(reason), "{pointer}: {error}");
    }
    let mut repeated = catalog();
    let copy = repeated["plugins"][0].clone();
    repeated["plugins"].as_array_mut().unwrap().push(copy);
    assert!(parse_catalog(&repeated, BASE).is_err());
}

#[test]
fn a_local_catalog_may_point_to_local_plugins() {
    let parsed = parse_catalog(&catalog(), "http://127.0.0.1:9000/catalog.json").unwrap();
    assert_eq!(parsed.plugins[0].url, "http://127.0.0.1:9000/contador/plugin.json");
}

#[test]
fn a_template_is_checked_against_its_plugin() {
    let manifest = parse(
        &json!({"id": "contador", "name": "Contador", "version": "1.0.0",
                "tools": [{"name": "prazos", "description": "Prazos",
                           "endpoint": {"kind": "http", "url": "http://127.0.0.1:8790/prazos"}}],
                "schedules": [{"name": "Lembrar prazos", "cron": "0 9 15 * *", "prompt": "Avise"}]}),
        false,
    )
    .unwrap();
    let parsed = parse_catalog(&catalog(), BASE).unwrap();
    let mut template = parsed.agent("contador").unwrap().clone();
    template.check(&manifest).unwrap();
    template.tools.push(TemplateGrant {
        tool: "contador.apagar".into(),
        effect: "allow".into(),
    });
    assert!(template
        .check(&manifest)
        .unwrap_err()
        .to_string()
        .contains("contador.apagar"));
    template.tools.pop();
    template.schedules.push("Outra".into());
    assert!(template.check(&manifest).is_err());
}

#[test]
fn the_catalog_that_ships_with_the_repository_is_valid() {
    let shipped: Value = serde_json::from_str(include_str!("../../../../plugins/catalog.json")).unwrap();
    let parsed = parse_catalog(&shipped, DEFAULT_CATALOG).unwrap();
    assert!(parsed.agents.len() >= 3);
    for template in &parsed.agents {
        let plugin = parsed.plugin(&template.plugin).unwrap();
        let file = plugin.url.rsplit("/plugins/").next().unwrap();
        let path = format!("{}/../../plugins/{file}", env!("CARGO_MANIFEST_DIR"));
        let manifest: Value = serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        let manifest = parse(&manifest, false).unwrap();
        assert_eq!(manifest.version, plugin.version, "{}", plugin.id);
        template.check(&manifest).unwrap();
    }
}
