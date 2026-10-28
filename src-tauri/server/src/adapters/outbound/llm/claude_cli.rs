//! The local Claude Code CLI as an LLM: `claude -p` with no built-in tools, none of the operator's own
//! setup (hooks, plugins, CLAUDE.md) and no MCP server but the run's own (the system agent calls the
//! app's tools through it), returning the JSON Schema's structured output.
//! OpenClaude (a Claude Code fork for other providers) takes the same flags and runs OpenRouter
//! models with the agent's key. The prompt (which carries the contact's words) goes through stdin,
//! never the command line.
use super::launcher::{find, Cli, Launcher};
use crate::application::ports::{Completion, Llm, LlmMcp, LlmRequest, TokenUsage};
use crate::domain::error::{fail, Error, HelpdeskError, Result};
use async_trait::async_trait;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;
use tokio::io::AsyncWriteExt;

const CLAUDE: Cli = Cli {
    var: "WAMCP_CLAUDE_BIN",
    exe: "claude",
    npm_script: Some("@anthropic-ai/claude-code/cli.js"),
};
const OPENCLAUDE: Cli = Cli {
    var: "WAMCP_OPENCLAUDE_BIN",
    exe: "openclaude",
    npm_script: Some("@gitlawb/openclaude/bin/openclaude"),
};
const OPENROUTER_URL: &str = "https://openrouter.ai/api/v1";
/// Runs that call MCP tools take several model turns.
const TOOLS_TIMEOUT: Duration = Duration::from_secs(600);

pub struct ClaudeCli {
    launcher: Option<Launcher>,
    /// OpenClaude against OpenRouter instead of Claude Code with the operator's login.
    openrouter: bool,
    work_dir: PathBuf,
    timeout: Duration,
}

impl ClaudeCli {
    pub fn new(work_dir: PathBuf) -> Self {
        Self {
            launcher: find(&CLAUDE),
            openrouter: false,
            work_dir,
            timeout: Duration::from_secs(180),
        }
    }

    /// OpenClaude installed by the operator (`npm install -g @gitlawb/openclaude`).
    pub fn openclaude(work_dir: PathBuf) -> Self {
        Self {
            launcher: find(&OPENCLAUDE),
            openrouter: true,
            ..Self::new(work_dir)
        }
    }

    /// Runs this program instead of the one found on the computer (tests).
    pub fn with_launcher(mut self, launcher: Launcher) -> Self {
        self.launcher = Some(launcher);
        self
    }

    fn label(&self) -> &'static str {
        if self.openrouter {
            "OpenClaude"
        } else {
            "Claude Code"
        }
    }
}

/// Where Claude Code is installed (`WAMCP_CLAUDE_BIN`, PATH, `~/.local/bin` or npm).
pub fn find_claude() -> Option<PathBuf> {
    find(&CLAUDE).map(|l| l.program)
}

/// Environment of every run: the user's claude.ai connectors (Gmail, Drive…) are not loaded, since
/// `--strict-mcp-config` does not cover them and agents must only reach what the app grants.
pub const ISOLATION_ENV: &[(&str, &str)] = &[("ENABLE_CLAUDEAI_MCP_SERVERS", "false")];

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

/// The `--mcp-config` file of a run: one Streamable HTTP server with its bearer token (a file, so the
/// token never shows on the command line).
pub fn mcp_config(mcp: &LlmMcp) -> Value {
    json!({ "mcpServers": { mcp.name.as_str(): {
        "type": "http",
        "url": mcp.url,
        "headers": { "Authorization": format!("Bearer {}", mcp.token) },
        // Connected (and its tools listed) before the model starts, not in the background.
        "alwaysLoad": true
    } } })
}

/// Extra arguments of a run with an MCP server: only that server is loaded and all of its tools are
/// allowed (built-in tools stay off).
pub fn mcp_arguments(mcp: &LlmMcp, config: &Path) -> Vec<String> {
    vec![
        "--mcp-config".into(),
        config.to_string_lossy().into_owned(),
        "--allowedTools".into(),
        format!("mcp__{}", mcp.name),
    ]
}

/// `--output-format json` prints one result object; the schema's answer is in `structured_output`
/// (or, for models without structured output, a JSON object as the result text).
pub fn parse_output(stdout: &[u8], stderr: &[u8]) -> Result<Value> {
    parse_output_of("Claude Code", stdout, stderr)
}

fn parse_output_of(label: &str, stdout: &[u8], stderr: &[u8]) -> Result<Value> {
    let text = String::from_utf8_lossy(stdout);
    let result = text
        .lines()
        .rev()
        .find(|line| line.trim_start().starts_with('{'))
        .and_then(|line| serde_json::from_str::<Value>(line).ok());
    let Some(result) = result else {
        let detail = String::from_utf8_lossy(stderr).trim().to_string();
        return fail(if detail.is_empty() {
            format!("{label} não respondeu")
        } else {
            detail
        });
    };
    if result["is_error"].as_bool() == Some(true) {
        return fail(format!("{label}: {}", result["result"].as_str().unwrap_or("erro")));
    }
    if let Some(answer) = result.get("structured_output").filter(|v| v.is_object()) {
        return Ok(answer.clone());
    }
    let inline = result["result"]
        .as_str()
        .map(|t| t.trim().trim_start_matches("```json").trim_matches('`').trim())
        .and_then(|t| serde_json::from_str::<Value>(t).ok())
        .filter(Value::is_object);
    match inline {
        Some(answer) => Ok(answer),
        None => fail(format!("{label} respondeu sem a saída estruturada")),
    }
}

/// Tokens and cost of the call from the result object's `usage` and `total_cost_usd` (the cost is
/// what the API would charge, also reported when Claude Code runs on a subscription).
pub fn parse_usage(stdout: &[u8]) -> TokenUsage {
    let text = String::from_utf8_lossy(stdout);
    let Some(result) = text
        .lines()
        .rev()
        .find(|line| line.trim_start().starts_with('{'))
        .and_then(|line| serde_json::from_str::<Value>(line).ok())
    else {
        return TokenUsage::default();
    };
    let usage = &result["usage"];
    let count = |key: &str| usage[key].as_i64().unwrap_or(0);
    TokenUsage {
        input_tokens: count("input_tokens") + count("cache_creation_input_tokens") + count("cache_read_input_tokens"),
        cached_input_tokens: count("cache_read_input_tokens"),
        output_tokens: count("output_tokens"),
        cost_usd: result["total_cost_usd"].as_f64(),
    }
}

/// Removed when the run ends, whatever the outcome (it holds the run's MCP token).
struct TempFile(PathBuf);

impl Drop for TempFile {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

#[async_trait]
impl Llm for ClaudeCli {
    async fn complete(&self, request: &LlmRequest) -> Result<Completion> {
        let Some(launcher) = &self.launcher else {
            return fail(if self.openrouter {
                "OpenClaude não encontrado. Instale com npm install -g @gitlawb/openclaude ou defina WAMCP_OPENCLAUDE_BIN."
            } else {
                "Claude Code não encontrado. Instale-o ou defina WAMCP_CLAUDE_BIN."
            });
        };
        let mut args = arguments(request);
        if self.openrouter {
            // OpenClaude takes the OpenRouter model from OPENAI_MODEL.
            if let Some(at) = args.iter().position(|a| a == "--model") {
                args.drain(at..at + 2);
            }
        }
        std::fs::create_dir_all(&self.work_dir).map_err(Error::internal)?;
        let config = match &request.mcp {
            Some(_) if self.openrouter => return fail("Ferramentas MCP só rodam no Claude Code (claude_cli)"),
            Some(mcp) => {
                let path = self
                    .work_dir
                    .join(format!("mcp-{}.json", uuid::Uuid::new_v4().simple()));
                std::fs::write(&path, mcp_config(mcp).to_string()).map_err(Error::internal)?;
                args.extend(mcp_arguments(mcp, &path));
                Some(TempFile(path))
            }
            None => None,
        };
        let timeout = if config.is_some() { TOOLS_TIMEOUT } else { self.timeout };
        let mut command = launcher.command();
        command
            .args(args)
            .current_dir(&self.work_dir)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        for secret in ["WAMCP_ADMIN_TOKEN", "CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT"] {
            command.env_remove(secret);
        }
        command.envs(ISOLATION_ENV.iter().copied());
        if config.is_some() {
            // Wait for the run's server instead of starting the model before its tools exist.
            command.env("MCP_CONNECTION_NONBLOCKING", "false");
        }
        if self.openrouter {
            let Some(model) = request.model.as_deref().map(str::trim).filter(|m| !m.is_empty()) else {
                return fail("Informe no agente o modelo do OpenRouter (ex.: openai/gpt-4o-mini)");
            };
            let Some(key) = request.api_key.as_deref().filter(|k| !k.is_empty()) else {
                return fail("Cadastre no agente a credencial OPENROUTER_API_KEY com a chave do OpenRouter");
            };
            command
                .env("CLAUDE_CODE_USE_OPENAI", "1")
                .env("OPENAI_BASE_URL", OPENROUTER_URL)
                .env("OPENAI_API_KEY", key)
                .env("OPENAI_MODEL", model);
        }
        let mut child = command.spawn().map_err(Error::internal)?;
        if let Some(mut stdin) = child.stdin.take() {
            stdin
                .write_all(request.prompt.as_bytes())
                .await
                .map_err(Error::internal)?;
        }
        let output = tokio::time::timeout(timeout, child.wait_with_output())
            .await
            .map_err(|_| Error::from(HelpdeskError::new(format!("{} excedeu o tempo limite", self.label()))))?
            .map_err(Error::internal)?;
        Ok(Completion {
            answer: parse_output_of(self.label(), &output.stdout, &output.stderr)?,
            usage: parse_usage(&output.stdout),
        })
    }

    fn location(&self) -> Option<String> {
        self.launcher.as_ref().map(Launcher::describe)
    }
}
