//! Claude Code runs report their steps while they work: a fake Claude Code (a Node script) prints
//! stream-json lines and the run tells each note and tool call, then answers from the result line.
use parking_lot::Mutex;
use serde_json::json;
use std::path::PathBuf;
use std::process::Command;
use wamcp_server::adapters::outbound::llm::claude_cli::ClaudeCli;
use wamcp_server::adapters::outbound::llm::claude_stream::steps;
use wamcp_server::adapters::outbound::llm::launcher::Launcher;
use wamcp_server::application::ports::{Llm, LlmRequest, Progress};

const FAKE_CLAUDE: &str = r#"
const say = (content) => console.log(JSON.stringify({ type: 'assistant', message: { content } }));
process.stdin.resume();
process.stdin.on('end', () => {
  console.log(JSON.stringify({ type: 'system', subtype: 'init' }));
  say([{ type: 'thinking', thinking: '', signature: 'x' }]);
  say([{ type: 'text', text: 'Vou listar os agentes.' }]);
  say([{ type: 'tool_use', name: 'mcp__wamcp__list_agents', input: {} }]);
  console.log(JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result' }] } }));
  say([{ type: 'tool_use', name: 'StructuredOutput', input: { reply: 'São 2.' } }]);
  console.log(JSON.stringify({ type: 'result', structured_output: { reply: 'São 2.' }, usage: { input_tokens: 7 } }));
});
"#;

#[tokio::test]
async fn claude_code_runs_tell_their_steps_as_they_work() {
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
        prompt: "Quantos agentes?".into(),
        schema: json!({ "type": "object" }),
        api_key: None,
        mcp: None,
    };
    let seen = Mutex::new(Vec::new());
    let completion = claude
        .complete_live(&request, &|step| seen.lock().push(step))
        .await
        .unwrap();
    assert_eq!(completion.answer["reply"], "São 2.");
    assert_eq!(completion.usage.input_tokens, 7);
    assert_eq!(
        *seen.lock(),
        [
            Progress::Note("Vou listar os agentes.".into()),
            Progress::Tool("list_agents".into())
        ],
        "empty thinking and the answer itself are not steps"
    );
}

#[test]
fn lines_that_are_not_the_models_messages_have_no_steps() {
    assert!(steps("not json").is_empty());
    assert!(steps(r#"{"type":"user","message":{"content":[{"type":"text","text":"oi"}]}}"#).is_empty());
    assert_eq!(
        steps(r#"{"type":"assistant","message":{"content":[{"type":"tool_use","name":"WebSearch"}]}}"#),
        [Progress::Tool("WebSearch".into())]
    );
}
