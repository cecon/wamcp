//! Claude Code's `--output-format stream-json`: one JSON object per line while the run works (the
//! model's messages, tool calls and results), then the same result object `json` prints. The steps
//! go to the run's progress as they arrive; the whole output is kept for the result.
use crate::application::ports::{Progress, ProgressSink};
use crate::domain::error::{Error, Result};
use serde_json::Value;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, BufReader};
use tokio::process::Child;

/// Tool that carries the structured answer (`--json-schema`): the answer itself, not a step.
const ANSWER_TOOL: &str = "StructuredOutput";

/// The steps of one output line: what the model wrote and the tools it called (MCP tools without
/// their `mcp__<server>__` prefix).
pub fn steps(line: &str) -> Vec<Progress> {
    let Ok(event) = serde_json::from_str::<Value>(line) else {
        return Vec::new();
    };
    if event["type"] != "assistant" {
        return Vec::new();
    }
    let Some(blocks) = event["message"]["content"].as_array() else {
        return Vec::new();
    };
    blocks
        .iter()
        .filter_map(|block| match block["type"].as_str()? {
            "text" => non_empty(block["text"].as_str()?).map(Progress::Note),
            "thinking" => non_empty(block["thinking"].as_str()?).map(Progress::Note),
            "tool_use" => {
                let name = block["name"].as_str()?;
                (name != ANSWER_TOOL).then(|| Progress::Tool(tool_label(name)))
            }
            _ => None,
        })
        .collect()
}

fn non_empty(text: &str) -> Option<String> {
    let text = text.trim();
    (!text.is_empty()).then(|| text.to_string())
}

fn tool_label(name: &str) -> String {
    match name.strip_prefix("mcp__").and_then(|rest| rest.split_once("__")) {
        Some((_, tool)) => tool.to_string(),
        None => name.to_string(),
    }
}

/// Reads the child's stdout line by line until it exits, telling `progress` each step, and returns
/// stdout and stderr whole (stderr is drained alongside so a chatty run never blocks on it).
pub async fn read_run(child: &mut Child, progress: ProgressSink<'_>) -> Result<(Vec<u8>, Vec<u8>)> {
    let stderr = child.stderr.take();
    let drain = tokio::spawn(async move {
        let mut text = Vec::new();
        if let Some(mut stderr) = stderr {
            let _ = stderr.read_to_end(&mut text).await;
        }
        text
    });
    let mut stdout = Vec::new();
    if let Some(pipe) = child.stdout.take() {
        let mut lines = BufReader::new(pipe).lines();
        while let Some(line) = lines.next_line().await.map_err(Error::internal)? {
            steps(&line).into_iter().for_each(progress);
            stdout.extend_from_slice(line.as_bytes());
            stdout.push(b'\n');
        }
    }
    child.wait().await.map_err(Error::internal)?;
    Ok((stdout, drain.await.unwrap_or_default()))
}
