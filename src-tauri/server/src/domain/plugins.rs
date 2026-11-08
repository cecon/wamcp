//! Plugins: what an agent can do comes from the plugins installed here. A plugin is a manifest
//! (`plugin.json`) with skills (instructions), tools served outside this process (HTTP or MCP) and
//! the credentials those tools need. The model never sees a credential: the server applies it.
use super::error::{fail, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// How a plugin tool is reached.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EndpointKind {
    /// `POST` of the arguments as JSON; the answer is the result.
    Http,
    /// A Model Context Protocol server over Streamable HTTP (`tools/call`).
    Mcp,
    /// Served by the app itself (only the plugins that ship with it).
    Builtin,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Endpoint {
    pub kind: EndpointKind,
    #[serde(default)]
    pub url: String,
    /// The credential sent as `Authorization: Bearer`.
    #[serde(default)]
    pub credential: Option<String>,
    /// The tool's name on an MCP server, when it differs.
    #[serde(default)]
    pub remote_name: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PluginTool {
    pub name: String,
    pub description: String,
    #[serde(default = "empty_schema")]
    pub input_schema: Value,
    /// Changes something outside the app: needs approval under `suggest_only`.
    #[serde(default)]
    pub side_effects: bool,
    /// Needs approval under `approval_for_sensitive`.
    #[serde(default)]
    pub sensitive: bool,
    /// Never offered to a run that answers a customer's message (prompt injection).
    #[serde(default)]
    pub internal_only: bool,
    pub endpoint: Endpoint,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PluginSkill {
    pub name: String,
    #[serde(default)]
    pub description: String,
    pub instructions: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CredentialDef {
    pub name: String,
    #[serde(default)]
    pub help: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Manifest {
    pub id: String,
    pub name: String,
    pub version: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub skills: Vec<PluginSkill>,
    #[serde(default)]
    pub tools: Vec<PluginTool>,
    #[serde(default)]
    pub credentials: Vec<CredentialDef>,
}

fn empty_schema() -> Value {
    serde_json::json!({ "type": "object", "properties": {} })
}

impl Manifest {
    /// The full name agents call: `<plugin>.<tool>`.
    pub fn tool_name(&self, tool: &PluginTool) -> String {
        format!("{}.{}", self.id, tool.name)
    }

    /// The name of a plugin skill in the skill library.
    pub fn skill_name(&self, skill: &PluginSkill) -> String {
        format!("{}: {}", self.name, skill.name)
    }
}

fn slug(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 40
        && value
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' || c == '_')
}

/// Plain HTTP only reaches this computer; anything else must be HTTPS.
pub fn allowed_url(url: &str) -> bool {
    let local = ["http://127.0.0.1", "http://localhost", "http://[::1]"];
    let boundary = |rest: &str| rest.is_empty() || rest.starts_with([':', '/']);
    url.strip_prefix("https://").is_some_and(|rest| !rest.is_empty())
        || local
            .iter()
            .any(|prefix| url.strip_prefix(prefix).is_some_and(boundary))
}

/// Parses and checks a manifest. `builtin` allows the endpoints only the app's own plugins use.
pub fn parse(json: &Value, builtin: bool) -> Result<Manifest> {
    let manifest: Manifest = match serde_json::from_value(json.clone()) {
        Ok(manifest) => manifest,
        Err(error) => return fail(format!("Manifesto inválido: {error}")),
    };
    validate(&manifest, builtin)?;
    Ok(manifest)
}

fn validate(m: &Manifest, builtin: bool) -> Result<()> {
    if !slug(&m.id) {
        return fail("O id do plugin usa só letras minúsculas, números, - e _ (até 40)");
    }
    if m.name.trim().is_empty() || m.name.chars().count() > 80 || m.version.trim().is_empty() {
        return fail("Informe nome (até 80 caracteres) e versão do plugin");
    }
    let mut names: Vec<&str> = Vec::new();
    for tool in &m.tools {
        if !slug(&tool.name) || names.contains(&tool.name.as_str()) {
            return fail(format!("Nome de ferramenta inválido ou repetido: {}", tool.name));
        }
        names.push(&tool.name);
        if tool.description.trim().is_empty() || !tool.input_schema.is_object() {
            return fail(format!("A ferramenta {} precisa de descrição e esquema", tool.name));
        }
        let endpoint = &tool.endpoint;
        match endpoint.kind {
            EndpointKind::Builtin if !builtin => return fail("Só plugins do próprio app usam endpoint builtin"),
            EndpointKind::Http | EndpointKind::Mcp if !allowed_url(&endpoint.url) => {
                return fail(format!(
                    "Endereço da ferramenta {}: use HTTPS (HTTP só local)",
                    tool.name
                ))
            }
            _ => {}
        }
        if let Some(credential) = &endpoint.credential {
            if !m.credentials.iter().any(|c| &c.name == credential) {
                return fail(format!("Credencial não declarada: {credential}"));
            }
        }
    }
    for skill in &m.skills {
        if skill.name.trim().is_empty() || skill.instructions.trim().is_empty() {
            return fail("Cada skill precisa de nome e instruções");
        }
    }
    if m.credentials.iter().any(|c| !slug(&c.name)) {
        return fail("Nome de credencial inválido");
    }
    Ok(())
}

#[cfg(test)]
#[path = "plugins_tests.rs"]
mod tests;
