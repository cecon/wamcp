//! Agent runs of Claude Code start without the user's claude.ai connectors (Gmail, Drive…): a fake
//! Claude Code (a Node script) answers with what its environment received.
use serde_json::{json, Value};
use std::path::PathBuf;
use std::process::Command;
use wamcp_server::adapters::outbound::llm::claude_cli::ClaudeCli;
use wamcp_server::adapters::outbound::llm::launcher::Launcher;
use wamcp_server::application::ports::{Llm, LlmRequest};

const FAKE_CLAUDE: &str = r#"
process.stdin.resume();
process.stdin.on('end', () => {
  const env = process.env;
  const reply = [env.ENABLE_CLAUDEAI_MCP_SERVERS, env.WAMCP_ADMIN_TOKEN].join('|');
  console.log(JSON.stringify({ type: 'result', structured_output: { reply, handoff: false } }));
});
"#;

#[tokio::test]
async fn claude_code_runs_without_the_users_claude_ai_connectors() {
    if Command::new("node").arg("--version").output().is_err() {
        eprintln!("node not installed: skipped");
        return;
    }
    let dir = tempfile::tempdir().unwrap();
    let script = dir.path().join("claude.js");
    std::fs::write(&script, FAKE_CLAUDE).unwrap();
    let claude = ClaudeCli::new(dir.path().join("work")).with_launcher(Launcher {
        program: PathBuf::from("node"),
        args: vec![script.to_string_lossy().into_owned()],
    });
    let request = LlmRequest {
        provider: "claude_cli".into(),
        model: None,
        system: "Responda.".into(),
        prompt: "Oi".into(),
        schema: json!({ "type": "object" }),
        api_key: None,
        mcp: None,
    };
    let answer: Value = claude.complete(&request).await.unwrap().answer;
    assert_eq!(answer["reply"], "false|", "connectors off and no admin token");
}
