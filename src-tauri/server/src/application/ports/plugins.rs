use crate::domain::error::Result;
use crate::domain::plugins::Manifest;
use async_trait::async_trait;
use serde::Serialize;
use serde_json::Value;

/// An installed plugin as stored.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct InstalledPlugin {
    pub manifest: Manifest,
    pub enabled: bool,
    /// Ships with the app (cannot be removed).
    pub builtin: bool,
    pub installed: String,
    pub updated: String,
    /// Where the manifest was installed from (`https://…/plugin.json`), to check for updates.
    pub source: Option<String>,
}

/// The installed plugins and their sealed credentials.
pub trait PluginRepo {
    fn plugins(&self) -> Result<Vec<InstalledPlugin>>;
    fn plugin(&self, id: &str) -> Result<Option<InstalledPlugin>>;
    /// Inserts or replaces the plugin's manifest (an update keeps `enabled` and the credentials).
    fn save_plugin(&self, manifest: &Manifest, builtin: bool) -> Result<InstalledPlugin>;
    fn set_plugin_enabled(&self, id: &str, enabled: bool) -> Result<()>;
    fn set_plugin_source(&self, id: &str, source: Option<&str>) -> Result<()>;
    fn delete_plugin(&self, id: &str) -> Result<()>;
    /// The names of the credentials that have a value.
    fn plugin_credential_names(&self, id: &str) -> Result<Vec<String>>;
    fn plugin_credential(&self, id: &str, name: &str) -> Result<Option<String>>;
    /// `None` removes the value.
    fn set_plugin_credential(&self, id: &str, name: &str, sealed: Option<&str>) -> Result<()>;
}

/// Calls a plugin tool served outside the app.
#[async_trait]
pub trait PluginTransport: Send + Sync {
    /// `POST` of the arguments as JSON to `url`; the JSON answer is the result.
    async fn http(&self, url: &str, bearer: Option<&str>, args: &Value) -> Result<Value>;
    /// `tools/call` on an MCP server over Streamable HTTP.
    async fn mcp(&self, url: &str, bearer: Option<&str>, tool: &str, args: &Value) -> Result<Value>;
    /// `GET` of a plugin manifest (JSON).
    async fn manifest(&self, url: &str) -> Result<Value>;
}
