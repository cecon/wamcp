//! The run's OpenCode process setup: where the program is, its isolated config and a free port.
use crate::application::ports::RunSpec;
use crate::domain::error::{Error, Result};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

/// Built-in OpenCode tools, all off: agents only use what the engine serves and authorizes.
const BUILT_IN: [&str; 17] = [
    "bash",
    "read",
    "glob",
    "grep",
    "list",
    "edit",
    "write",
    "patch",
    "apply_patch",
    "task",
    "webfetch",
    "websearch",
    "skill",
    "todowrite",
    "todoread",
    "question",
    "codesearch",
];

/// `WAMCP_OPENCODE_BIN`, `opencode.exe`/`opencode` on PATH, or the native binary of an npm install.
pub(super) fn find_program() -> Option<PathBuf> {
    if let Some(path) = std::env::var_os("WAMCP_OPENCODE_BIN") {
        return Some(PathBuf::from(path));
    }
    let exe = if cfg!(windows) { "opencode.exe" } else { "opencode" };
    let dirs: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).collect())
        .unwrap_or_default();
    dirs.iter().find_map(|dir| {
        [
            dir.join(exe),
            dir.join("node_modules").join("opencode-ai").join("bin").join(exe),
            dir.join("..")
                .join("lib")
                .join("node_modules")
                .join("opencode-ai")
                .join("bin")
                .join(exe),
        ]
        .into_iter()
        .find(|candidate| candidate.is_file())
    })
}

/// An OpenCode config with no built-in tool and the model key read from the env (when there is one).
pub(super) fn base_config(provider: &str, has_key: bool) -> Value {
    let deny: serde_json::Map<String, Value> = BUILT_IN.iter().map(|t| ((*t).to_string(), json!("deny"))).collect();
    let off: serde_json::Map<String, Value> = BUILT_IN.iter().map(|t| ((*t).to_string(), json!(false))).collect();
    let mut config = json!({
        "$schema": "https://opencode.ai/config.json",
        "autoupdate": false,
        "share": "disabled",
        "permission": Value::Object(deny),
        "tools": Value::Object(off),
    });
    config["permission"]["external_directory"] = json!("deny");
    if has_key {
        config["provider"] = json!({provider: {"options": {"apiKey": "{env:WAMCP_MODEL_API_KEY}"}}});
    }
    config
}

/// An engine run's config: the base one plus the engine's MCP server with the run's token.
pub(super) fn config(spec: &RunSpec, mcp_url: &str, provider: &str) -> Value {
    let mut config = base_config(provider, spec.api_key.is_some());
    config["mcp"] = json!({"engine": {"type": "remote", "url": mcp_url, "enabled": true,
        "headers": {"Authorization": format!("Bearer {}", spec.token)}}});
    config
}

/// Waits for `opencode serve` to answer (30 s).
pub(super) async fn wait_ready(http: &reqwest::Client, base: &str, password: &str) -> Result<()> {
    for _ in 0..60 {
        let ready = http
            .get(format!("{base}/session/status"))
            .basic_auth("opencode", Some(password))
            .send()
            .await
            .is_ok_and(|r| r.status().is_success());
        if ready {
            return Ok(());
        }
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    }
    crate::domain::error::fail("O OpenCode não respondeu em 30 s")
}

pub(super) fn free_port() -> Result<u16> {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").map_err(Error::internal)?;
    Ok(listener.local_addr().map_err(Error::internal)?.port())
}

/// Variables a run inherits from the app: only what a Windows/Unix process needs to start. Model
/// keys, `OPENCODE_*` settings and the operator's app data never pass; home points into the run.
const INHERITED: [&str; 8] = [
    "PATH",
    "PATHEXT",
    "SYSTEMROOT",
    "SYSTEMDRIVE",
    "WINDIR",
    "COMSPEC",
    "TEMP",
    "TMP",
];

/// `opencode serve` for one run: a clean environment whose home, config, data, state and cache all
/// live in the run's folder, so neither the operator's OpenCode or Claude Code setup nor their
/// connectors and keys reach the agent.
pub(super) fn serve_command(
    program: &Path,
    dir: &Path,
    port: u16,
    password: &str,
    config: &str,
    api_key: Option<&str>,
) -> tokio::process::Command {
    let mut command = tokio::process::Command::new(program);
    command
        .args(["serve", "--port", &port.to_string(), "--hostname", "127.0.0.1"])
        .current_dir(dir)
        .env_clear();
    for name in INHERITED {
        if let Some(value) = std::env::var_os(name) {
            command.env(name, value);
        }
    }
    let xdg = |name: &str| dir.join("xdg").join(name);
    command
        .env("HOME", dir)
        .env("USERPROFILE", dir)
        .env("XDG_CONFIG_HOME", xdg("config"))
        .env("XDG_DATA_HOME", xdg("data"))
        .env("XDG_STATE_HOME", xdg("state"))
        .env("XDG_CACHE_HOME", xdg("cache"))
        .env("OPENCODE_SERVER_PASSWORD", password)
        .env("OPENCODE_CONFIG_CONTENT", config)
        .env("OPENCODE_DISABLE_AUTOUPDATE", "1")
        .env("OPENCODE_DISABLE_CLAUDE_CODE", "1")
        .env("ENABLE_CLAUDEAI_MCP_SERVERS", "false");
    if let Some(key) = api_key {
        command.env("WAMCP_MODEL_API_KEY", key);
    }
    command
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    #[test]
    fn a_run_gets_a_clean_environment_rooted_in_its_folder() {
        let dir = Path::new("F:/runs/run-7");
        let command = serve_command(Path::new("opencode.exe"), dir, 4100, "secret", "{}", Some("sk-agent"));
        let std = command.as_std();
        let env: HashMap<String, String> = std
            .get_envs()
            .filter_map(|(k, v)| Some((k.to_string_lossy().into_owned(), v?.to_string_lossy().into_owned())))
            .collect();
        for name in ["HOME", "USERPROFILE"] {
            assert_eq!(env[name], dir.to_string_lossy());
        }
        assert!(env["XDG_CONFIG_HOME"].starts_with(&*dir.to_string_lossy()));
        assert_eq!(env["OPENCODE_DISABLE_CLAUDE_CODE"], "1");
        assert_eq!(env["ENABLE_CLAUDEAI_MCP_SERVERS"], "false");
        assert_eq!(env["WAMCP_MODEL_API_KEY"], "sk-agent");
        // Nothing else from the app's environment: no operator keys, no OPENCODE_* overrides.
        let allowed: Vec<&str> = INHERITED.to_vec();
        for name in env.keys() {
            let ours = name.starts_with("XDG_") || name.starts_with("OPENCODE_") || name == "WAMCP_MODEL_API_KEY";
            let base = ["HOME", "USERPROFILE", "ENABLE_CLAUDEAI_MCP_SERVERS"].contains(&name.as_str());
            assert!(ours || base || allowed.contains(&name.as_str()), "leaked {name}");
        }
        assert!(!env.contains_key("OPENCODE_CONFIG") && !env.contains_key("ANTHROPIC_API_KEY"));
        let args: Vec<String> = std.get_args().map(|a| a.to_string_lossy().into_owned()).collect();
        assert_eq!(args, ["serve", "--port", "4100", "--hostname", "127.0.0.1"]);
    }
}
