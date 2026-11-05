//! What the agent runtimes read back and the model answer that is sent: the OpenRouter key, the
//! Codex and Claude Code outputs, and replies cleaned of leaked tool-call markup.
use serde_json::json;
use std::path::Path;
use wamcp_server::adapters::outbound::llm::claude_cli::parse_output;
use wamcp_server::adapters::outbound::llm::codex_cli::{codex_arguments, parse_codex_answer};
use wamcp_server::application::ports::LlmRequest;
use wamcp_server::domain::llm::{clean_reply, openrouter_key, parse_answer};
use wamcp_server::domain::model::SealedCredential;

#[test]
fn openrouter_key_prefers_the_named_credential_else_the_only_key() {
    let credential = |name: &str, kind: &str| SealedCredential {
        name: name.into(),
        kind: kind.into(),
        secret: format!("sealed-{name}"),
    };
    let both = [credential("ERP", "api_key"), credential("openrouter_api_key", "secret")];
    assert_eq!(openrouter_key(&both).unwrap().name, "openrouter_api_key");
    let only = [credential("CHAVE", "bearer"), credential("SENHA", "basic")];
    assert_eq!(openrouter_key(&only).unwrap().name, "CHAVE");
    let many = [credential("A", "api_key"), credential("B", "api_key")];
    assert_eq!(openrouter_key(&many), None, "ambiguous");
}

#[test]
fn codex_and_claude_outputs_are_read_back() {
    let request = LlmRequest {
        provider: "codex_cli".into(),
        model: Some("gpt-5-mini".into()),
        system: "Sistema".into(),
        prompt: "Cliente: oi".into(),
        schema: json!({ "type": "object" }),
        api_key: None,
        mcp: None,
    };
    let args = codex_arguments(&request, Path::new("s.json"), Path::new("a.txt"));
    let after = |flag: &str| args[args.iter().position(|a| a == flag).unwrap() + 1].clone();
    assert_eq!(args[0], "exec");
    assert_eq!(after("--sandbox"), "read-only");
    assert_eq!(after("--output-schema"), "s.json");
    assert_eq!(after("--output-last-message"), "a.txt");
    assert_eq!(after("--model"), "gpt-5-mini");
    assert_eq!(args.last().unwrap(), "-", "prompt from stdin");
    assert!(!args.iter().any(|a| a.contains("oi")));

    let fenced = "```json\n{\"reply\":\"Oi\",\"handoff\":false}\n```";
    assert_eq!(parse_codex_answer(fenced, b"").unwrap()["reply"], "Oi");
    let error = parse_codex_answer("", b"warn\nNot logged in\n")
        .unwrap_err()
        .to_string();
    assert!(error.contains("Not logged in"));

    let inline = br#"{"type":"result","is_error":false,"result":"{\"reply\":\"Oi\",\"handoff\":true}"}"#;
    assert_eq!(parse_output(inline, b"").unwrap()["handoff"], true);
}


#[test]
fn replies_lose_leaked_tool_call_markup_and_resolve_defaults_to_false() {
    assert_eq!(clean_reply("Aprovo assim que o CI fechar.\n</parameter>\n</invoke>"), "Aprovo assim que o CI fechar.");
    assert_eq!(clean_reply("<invoke name=\"x\">\nOi"), "Oi");
    let inline = "Use `</invoke>` para fechar.\n```xml\n</parameter>\n```";
    assert_eq!(clean_reply(inline), inline, "markup inside the text stays");
    let old = parse_answer(&json!({ "reply": "Oi", "handoff": false })).unwrap();
    assert!(!old.resolve);
    let done = parse_answer(&json!({ "reply": "", "handoff": false, "resolve": true })).unwrap();
    assert!(done.resolve);
}
