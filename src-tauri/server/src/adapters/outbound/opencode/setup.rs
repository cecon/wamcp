//! The run's OpenCode process setup: where the program is, its isolated config and a free port.
use crate::application::ports::RunSpec;
use crate::domain::error::{Error, Result};
use serde_json::{json, Value};
use std::path::PathBuf;

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

/// The run's OpenCode config: no built-in tool, the engine's MCP server, the model key from the env.
pub(super) fn config(spec: &RunSpec, mcp_url: &str, provider: &str) -> Value {
    let deny: serde_json::Map<String, Value> = BUILT_IN.iter().map(|t| ((*t).to_string(), json!("deny"))).collect();
    let off: serde_json::Map<String, Value> = BUILT_IN.iter().map(|t| ((*t).to_string(), json!(false))).collect();
    let mut config = json!({
        "$schema": "https://opencode.ai/config.json",
        "autoupdate": false,
        "share": "disabled",
        "permission": Value::Object(deny),
        "tools": Value::Object(off),
        "mcp": {"engine": {"type": "remote", "url": mcp_url, "enabled": true,
            "headers": {"Authorization": format!("Bearer {}", spec.token)}}},
    });
    config["permission"]["external_directory"] = json!("deny");
    if spec.api_key.is_some() {
        config["provider"] = json!({provider: {"options": {"apiKey": "{env:WAMCP_MODEL_API_KEY}"}}});
    }
    config
}

pub(super) fn free_port() -> Result<u16> {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").map_err(Error::internal)?;
    Ok(listener.local_addr().map_err(Error::internal)?.port())
}
