//! The local Codex CLI as an LLM: `codex exec` in a read-only sandbox with the operator's own login,
//! the JSON Schema written to a file (`--output-schema`) and the final message read back from
//! `--output-last-message`. Codex has no system prompt flag, so the system text leads the prompt,
//! which goes through stdin (`-`), never the command line.
use super::launcher::{find, Cli, Launcher};
use crate::application::ports::{Completion, Llm, LlmRequest, TokenUsage};
use crate::domain::error::{fail, Error, HelpdeskError, Result};
use async_trait::async_trait;
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;
use tokio::io::AsyncWriteExt;

const CODEX: Cli = Cli {
    var: "WAMCP_CODEX_BIN",
    exe: "codex",
    npm_script: Some("@openai/codex/bin/codex.js"),
};

pub struct CodexCli {
    launcher: Option<Launcher>,
    work_dir: PathBuf,
    timeout: Duration,
}

impl CodexCli {
    pub fn new(work_dir: PathBuf) -> Self {
        Self {
            launcher: find(&CODEX),
            work_dir,
            timeout: Duration::from_secs(180),
        }
    }
}

/// Command-line arguments of one call; `schema` and `answer` are files in the work folder.
pub fn codex_arguments(request: &LlmRequest, schema: &Path, answer: &Path) -> Vec<String> {
    let mut args: Vec<String> = [
        "exec",
        "--skip-git-repo-check",
        "--sandbox",
        "read-only",
        "--color",
        "never",
        "--json",
    ]
    .map(String::from)
    .into();
    args.extend(["--output-schema".into(), schema.to_string_lossy().into_owned()]);
    args.extend(["--output-last-message".into(), answer.to_string_lossy().into_owned()]);
    if let Some(model) = request.model.as_deref().filter(|m| !m.trim().is_empty()) {
        args.extend(["--model".into(), model.trim().into()]);
    }
    args.push("-".into());
    args
}

/// The last message is the schema's JSON object (sometimes inside a ```json fence).
pub fn parse_codex_answer(text: &str, stderr: &[u8]) -> Result<Value> {
    let body = text.trim().trim_start_matches("```json").trim_matches('`').trim();
    match serde_json::from_str::<Value>(body).ok().filter(Value::is_object) {
        Some(answer) => Ok(answer),
        None => {
            let detail = String::from_utf8_lossy(stderr);
            let last = detail.lines().rev().find(|l| !l.trim().is_empty()).unwrap_or_default();
            fail(if last.is_empty() {
                "Codex CLI respondeu sem a saída estruturada".to_string()
            } else {
                format!("Codex CLI: {}", last.trim())
            })
        }
    }
}

/// With `--json`, stdout is one event per line; `turn.completed` carries the turn's token usage
/// (summed when there are several turns). Codex reports no cost.
pub fn codex_usage(stdout: &[u8]) -> TokenUsage {
    let mut usage = TokenUsage::default();
    for event in String::from_utf8_lossy(stdout)
        .lines()
        .filter_map(|line| serde_json::from_str::<Value>(line.trim()).ok())
    {
        let Some(turn) = event.get("usage").filter(|u| u.is_object()) else {
            continue;
        };
        usage.input_tokens += turn["input_tokens"].as_i64().unwrap_or(0);
        usage.cached_input_tokens += turn["cached_input_tokens"].as_i64().unwrap_or(0);
        usage.output_tokens += turn["output_tokens"].as_i64().unwrap_or(0);
    }
    usage
}

#[async_trait]
impl Llm for CodexCli {
    async fn complete(&self, request: &LlmRequest) -> Result<Completion> {
        let Some(launcher) = &self.launcher else {
            return fail(
                "Codex CLI não encontrado. Instale com npm install -g @openai/codex ou defina WAMCP_CODEX_BIN.",
            );
        };
        std::fs::create_dir_all(&self.work_dir).map_err(Error::internal)?;
        let call = uuid::Uuid::new_v4().simple().to_string();
        let schema = self.work_dir.join(format!("{call}.schema.json"));
        let answer = self.work_dir.join(format!("{call}.answer.txt"));
        std::fs::write(&schema, request.schema.to_string()).map_err(Error::internal)?;
        let result = self.run(launcher, request, &schema, &answer).await;
        let _ = std::fs::remove_file(&schema);
        let _ = std::fs::remove_file(&answer);
        result
    }

    fn location(&self) -> Option<String> {
        self.launcher.as_ref().map(Launcher::describe)
    }
}

impl CodexCli {
    async fn run(&self, launcher: &Launcher, request: &LlmRequest, schema: &Path, answer: &Path) -> Result<Completion> {
        let mut command = launcher.command();
        command
            .args(codex_arguments(request, schema, answer))
            .current_dir(&self.work_dir)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .env_remove("WAMCP_ADMIN_TOKEN");
        let mut child = command.spawn().map_err(Error::internal)?;
        if let Some(mut stdin) = child.stdin.take() {
            let prompt = format!("{}\n\n{}", request.system, request.prompt);
            stdin.write_all(prompt.as_bytes()).await.map_err(Error::internal)?;
        }
        let output = tokio::time::timeout(self.timeout, child.wait_with_output())
            .await
            .map_err(|_| Error::from(HelpdeskError::new("Codex CLI excedeu o tempo limite")))?
            .map_err(Error::internal)?;
        let text = std::fs::read_to_string(answer).unwrap_or_default();
        Ok(Completion {
            answer: parse_codex_answer(&text, &output.stderr)?,
            usage: codex_usage(&output.stdout),
        })
    }
}
