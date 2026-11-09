//! The store: a catalog (`catalog.json`) anyone can publish at an address, with no central server.
//! It lists skills (each one a plugin, installed from its `plugin.json`) and agent templates: a
//! plugin plus the agent that uses it (name, instructions, goals, runtime, the tools to grant and
//! the plugin's routines to create). Addresses in the catalog may be relative to the catalog's own.
use super::agents::{executes, RUNTIMES};
use super::error::{fail, Result};
use super::plugins::{allowed_url, slug, version, Manifest};
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Where the app looks for the store when the account sets no other address.
pub const DEFAULT_CATALOG: &str = "https://raw.githubusercontent.com/cecon/wamcp/main/plugins/catalog.json";
/// The account setting with another address.
pub const CATALOG_KEY: &str = "store_catalog_url";
const MAX_ENTRIES: usize = 200;

/// A skill of the store: one plugin.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct StorePlugin {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub category: String,
    /// A short icon name the screen knows (`calculator`, `bike`…); unknown names get a default.
    #[serde(default)]
    pub icon: String,
    /// The version at `url`, so the screen shows "Atualizar" without downloading each manifest.
    pub version: String,
    /// The `plugin.json` (absolute once parsed).
    pub url: String,
    /// A page with how to run the plugin's server.
    #[serde(default)]
    pub docs: Option<String>,
}

/// A tool the template grants to the agent it creates.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TemplateGrant {
    pub tool: String,
    /// `allow` (default) or `approval` (each call waits for a person).
    #[serde(default = "allow")]
    pub effect: String,
}

fn allow() -> String {
    "allow".into()
}

fn operator() -> String {
    "operator".into()
}

fn opencode() -> String {
    "opencode".into()
}

/// An agent template: installing it installs `plugin` and creates the agent.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AgentTemplate {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub category: String,
    #[serde(default)]
    pub icon: String,
    pub version: String,
    /// The id of a plugin of this catalog.
    pub plugin: String,
    /// The suggested name of the agent.
    pub agent_name: String,
    /// The agent's role (its profile is the first one with this role); it must execute.
    #[serde(default = "operator")]
    pub role: String,
    #[serde(default = "opencode")]
    pub runtime: String,
    #[serde(default)]
    pub model: Option<String>,
    pub instructions: String,
    #[serde(default)]
    pub goals: Vec<String>,
    #[serde(default)]
    pub tools: Vec<TemplateGrant>,
    /// Names of the plugin's routines (`schedules`) created for the agent.
    #[serde(default)]
    pub schedules: Vec<String>,
}

impl AgentTemplate {
    /// The agent's instructions: the template's, then its goals.
    pub fn agent_instructions(&self) -> String {
        if self.goals.is_empty() {
            return self.instructions.trim().to_string();
        }
        let goals: Vec<String> = self.goals.iter().map(|g| format!("- {}", g.trim())).collect();
        format!("{}\n\n## Objetivos\n{}", self.instructions.trim(), goals.join("\n"))
    }

    /// Checks the template against the plugin's manifest: the plugin's own tools exist, and so do
    /// the routines. Tools of other plugins (`mensagens.*`) are checked when granted.
    pub fn check(&self, manifest: &Manifest) -> Result<()> {
        let prefix = format!("{}.", manifest.id);
        for grant in &self.tools {
            let own = grant.tool.strip_prefix(&prefix);
            if own.is_some_and(|name| !manifest.tools.iter().any(|t| t.name == name)) {
                return fail(format!("O modelo libera {}, que o plugin não tem", grant.tool));
            }
        }
        for name in &self.schedules {
            if !manifest.schedules.iter().any(|s| &s.name == name) {
                return fail(format!("O modelo cria a rotina “{name}”, que o plugin não tem"));
            }
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Catalog {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub plugins: Vec<StorePlugin>,
    #[serde(default)]
    pub agents: Vec<AgentTemplate>,
}

impl Catalog {
    pub fn plugin(&self, id: &str) -> Option<&StorePlugin> {
        self.plugins.iter().find(|p| p.id == id)
    }

    pub fn agent(&self, id: &str) -> Option<&AgentTemplate> {
        self.agents.iter().find(|a| a.id == id)
    }
}

/// `url` resolved against the catalog's address (absolute addresses stay).
fn resolve(base: &str, url: &str) -> Result<String> {
    let joined = url::Url::parse(base).and_then(|base| base.join(url.trim()));
    match joined {
        Ok(url) if allowed_url(url.as_str()) => Ok(url.into()),
        _ => fail(format!("Endereço inválido na loja: {url} (use HTTPS; HTTP só local)")),
    }
}

fn card(id: &str, name: &str, version_text: &str, what: &str) -> Result<()> {
    if !slug(id) {
        return fail(format!("{what}: id inválido ({id})"));
    }
    if name.trim().is_empty() || name.chars().count() > 80 {
        return fail(format!("{what} {id}: informe o nome (até 80 caracteres)"));
    }
    if version(version_text).is_none() {
        return fail(format!("{what} {id}: a versão segue o formato 1.2.3"));
    }
    Ok(())
}

fn check_template(t: &AgentTemplate, catalog: &Catalog) -> Result<()> {
    card(&t.id, &t.name, &t.version, "Modelo de agente")?;
    if catalog.plugin(&t.plugin).is_none() {
        return fail(format!(
            "O modelo {} usa o plugin {}, que não está na loja",
            t.id, t.plugin
        ));
    }
    if t.agent_name.trim().is_empty() || t.agent_name.chars().count() > 80 {
        return fail(format!("O modelo {} precisa do nome do agente (até 80)", t.id));
    }
    if !executes(&t.role) {
        return fail(format!(
            "O modelo {}: a função precisa executar (não coordenador)",
            t.id
        ));
    }
    if !RUNTIMES.contains(&t.runtime.as_str()) {
        return fail(format!("O modelo {}: runtime desconhecido ({})", t.id, t.runtime));
    }
    if t.instructions.trim().is_empty() || t.agent_instructions().chars().count() > 8000 {
        return fail(format!("O modelo {}: instruções vazias ou longas demais", t.id));
    }
    if t.tools
        .iter()
        .any(|g| !["allow", "approval"].contains(&g.effect.as_str()))
    {
        return fail(format!("O modelo {}: efeito de ferramenta é allow ou approval", t.id));
    }
    Ok(())
}

/// Parses and checks the catalog downloaded from `base`, resolving its addresses.
pub fn parse_catalog(json: &Value, base: &str) -> Result<Catalog> {
    let mut catalog: Catalog = match serde_json::from_value(json.clone()) {
        Ok(catalog) => catalog,
        Err(error) => return fail(format!("Loja inválida: {error}")),
    };
    if catalog.plugins.len() + catalog.agents.len() > MAX_ENTRIES {
        return fail("A loja passa de 200 itens");
    }
    let mut ids: Vec<String> = Vec::new();
    for plugin in &mut catalog.plugins {
        card(&plugin.id, &plugin.name, &plugin.version, "Habilidade")?;
        if ids.contains(&plugin.id) {
            return fail(format!("Habilidade repetida na loja: {}", plugin.id));
        }
        ids.push(plugin.id.clone());
        plugin.url = resolve(base, &plugin.url)?;
        plugin.docs = plugin.docs.as_deref().map(|d| resolve(base, d)).transpose()?;
    }
    let mut templates: Vec<String> = Vec::new();
    for template in &catalog.agents {
        check_template(template, &catalog)?;
        if templates.contains(&template.id) {
            return fail(format!("Modelo de agente repetido na loja: {}", template.id));
        }
        templates.push(template.id.clone());
    }
    Ok(catalog)
}

#[cfg(test)]
#[path = "store_tests.rs"]
mod tests;
