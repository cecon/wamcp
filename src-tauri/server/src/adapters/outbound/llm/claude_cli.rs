//! The local Claude Code CLI as an LLM: `claude -p` with no tools, no MCP servers and none of the
//! operator's own setup (hooks, plugins, CLAUDE.md), returning the JSON Schema's structured output.
//! The prompt (which carries the contact's words) goes through stdin, never the command line.
use crate::application::ports::{Llm, LlmRequest};
use crate::domain::error::{fail, Error, Result};
use async_trait::async_trait;
use serde_json::Value;
use std::path::PathBuf;
use std::process::Stdio;
use std::time::Duration;
use tokio::io::AsyncWriteExt;
use tokio::process::Command;

pub struct ClaudeCli {
    program: Option<PathBuf>,
    work_dir: PathBuf,
    timeout: Duration,
}

impl ClaudeCli {
    pub fn new(work_dir: PathBuf) -> Self {
        Self {
            program: find_claude(),
            work_dir,
            timeout: Duration::from_secs(180),
        }
    }
}

/// `WAMCP_CLAUDE_BIN`, else `claude(.exe)` on PATH, else the native installer's `~/.local/bin`.
/// npm's `claude.cmd` needs a shell, which is never used, so on Windows only an `.exe` qualifies.
pub fn find_claude() -> Option<PathBuf> {
    if let Some(bin) = std::env::var_os("WAMCP_CLAUDE_BIN") {
        return Some(PathBuf::from(bin));
    }
    let name = if cfg!(windows) { "claude.exe" } else { "claude" };
    let on_path = std::env::var_os("PATH")
        .into_iter()
        .flat_map(|paths| std::env::split_paths(&paths).collect::<Vec<_>>())
        .map(|dir| dir.join(name))
        .find(|candidate| candidate.is_file());
    let home = std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" });
    on_path.or_else(|| {
        home.map(|h| PathBuf::from(h).join(".local").join("bin").join(name))
            .filter(|candidate| candidate.is_file())
    })
}

/// Command-line arguments of one call (the prompt itself is written to stdin).
pub fn arguments(request: &LlmRequest) -> Vec<String> {
    let mut args: Vec<String> = [
        "-p",
        "--output-format",
        "json",
        "--no-session-persistence",
        "--setting-sources",
        "project,local",
        "--settings",
        r#"{"disableAllHooks":true}"#,
        "--strict-mcp-config",
        "--tools",
        "",
    ]
    .map(String::from)
    .into();
    args.extend(["--system-prompt".into(), request.system.clone()]);
    args.extend(["--json-schema".into(), request.schema.to_string()]);
    if let Some(model) = request.model.as_deref().filter(|m| !m.trim().is_empty()) {
        args.extend(["--model".into(), model.trim().into()]);
    }
    args
}

/// `--output-format json` prints one result object; the schema's answer is in `structured_output`.
pub fn parse_output(stdout: &[u8], stderr: &[u8]) -> Result<Value> {
    let text = String::from_utf8_lossy(stdout);
    let result = text
        .lines()
        .rev()
        .find(|line| line.trim_start().starts_with('{'))
        .and_then(|line| serde_json::from_str::<Value>(line).ok());
    let Some(result) = result else {
        let detail = String::from_utf8_lossy(stderr).trim().to_string();
        return fail(if detail.is_empty() {
            "Claude Code não respondeu".into()
        } else {
            detail
        });
    };
    if result["is_error"].as_bool() == Some(true) {
        return fail(format!("Claude Code: {}", result["result"].as_str().unwrap_or("erro")));
    }
    match result.get("structured_output").filter(|v| v.is_object()) {
        Some(answer) => Ok(answer.clone()),
        None => fail("Claude Code respondeu sem a saída estruturada"),
    }
}

#[async_trait]
impl Llm for ClaudeCli {
    async fn complete(&self, request: &LlmRequest) -> Result<Value> {
        let Some(program) = &self.program else {
            return fail("Claude Code não encontrado. Instale-o ou defina WAMCP_CLAUDE_BIN.");
        };
        std::fs::create_dir_all(&self.work_dir).map_err(Error::internal)?;
        let mut command = Command::new(program);
        command
            .args(arguments(request))
            .current_dir(&self.work_dir)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        for secret in ["WAMCP_ADMIN_TOKEN", "CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT"] {
            command.env_remove(secret);
        }
        #[cfg(windows)]
        command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
        let mut child = command.spawn().map_err(Error::internal)?;
        if let Some(mut stdin) = child.stdin.take() {
            stdin
                .write_all(request.prompt.as_bytes())
                .await
                .map_err(Error::internal)?;
        }
        let output = tokio::time::timeout(self.timeout, child.wait_with_output())
            .await
            .map_err(|_| {
                Error::from(crate::domain::error::HelpdeskError::new(
                    "Claude Code excedeu o tempo limite",
                ))
            })?
            .map_err(Error::internal)?;
        parse_output(&output.stdout, &output.stderr)
    }
}
