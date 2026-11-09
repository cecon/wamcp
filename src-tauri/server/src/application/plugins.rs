//! Plugins decide what agents can do. This service installs and removes them (administrators),
//! keeps their skills in the skill library, and serves their tools to the engine as its
//! `BusinessTools`: a tool call goes to the plugin's endpoint with the credential applied here,
//! so the model never sees it.
pub mod messaging;
mod skills;
mod updates;

use super::ports::{BusinessTools, InstalledPlugin, PluginTransport, Repository, SecretBox};
use crate::domain::actor::Actor;
use crate::domain::engine::tools::{from_plugin, ToolDef};
use crate::domain::error::{fail, fail_with, Result};
use crate::domain::helpdesk::require_admin;
use crate::domain::plugins::{parse, version, EndpointKind, Manifest, PluginTool};
use async_trait::async_trait;
use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Arc;

/// A plugin as the settings screen shows it: which credentials already have a value.
#[derive(Debug, Serialize)]
pub struct PluginView {
    #[serde(flatten)]
    pub plugin: InstalledPlugin,
    pub credentials_set: Vec<String>,
}

#[derive(Clone)]
pub struct PluginService {
    repo: Arc<dyn Repository>,
    secrets: Arc<dyn SecretBox>,
    transport: Arc<dyn PluginTransport>,
    /// The tools of the plugins that ship with the app, by plugin id.
    builtins: Arc<HashMap<String, Arc<dyn BusinessTools>>>,
}

impl PluginService {
    /// Installs (or updates) the plugins that ship with the app: `(manifest, handler)`.
    pub fn new(
        repo: Arc<dyn Repository>,
        secrets: Arc<dyn SecretBox>,
        transport: Arc<dyn PluginTransport>,
        builtins: Vec<(Value, Arc<dyn BusinessTools>)>,
    ) -> Result<Self> {
        let mut handlers = HashMap::new();
        let service = Self {
            repo,
            secrets,
            transport,
            builtins: Arc::default(),
        };
        for (json, handler) in builtins {
            let manifest = parse(&json, true)?;
            let previous = service.repo.plugin(&manifest.id)?;
            service.repo.save_plugin(&manifest, true)?;
            service.sync_skills(previous.as_ref().map(|p| &p.manifest), Some(&manifest))?;
            handlers.insert(manifest.id.clone(), handler);
        }
        Ok(Self {
            builtins: Arc::new(handlers),
            ..service
        })
    }

    pub fn list(&self, actor: &Actor) -> Result<Vec<PluginView>> {
        require_admin(actor)?;
        self.repo
            .plugins()?
            .into_iter()
            .map(|plugin| self.view(plugin))
            .collect()
    }

    fn view(&self, plugin: InstalledPlugin) -> Result<PluginView> {
        let credentials_set = self.repo.plugin_credential_names(&plugin.manifest.id)?;
        Ok(PluginView {
            plugin,
            credentials_set,
        })
    }

    pub(super) fn find(&self, id: &str) -> Result<InstalledPlugin> {
        match self.repo.plugin(id)? {
            Some(plugin) => Ok(plugin),
            None => fail_with("Plugin não encontrado", 404),
        }
    }

    /// Installs a plugin from its manifest, or updates it (its credentials and state stay).
    pub fn install(&self, actor: &Actor, json: &Value) -> Result<PluginView> {
        require_admin(actor)?;
        let manifest = parse(json, false)?;
        let previous = self.repo.plugin(&manifest.id)?;
        if previous.as_ref().is_some_and(|p| p.builtin) {
            return fail_with("Este id pertence a um plugin do próprio app", 409);
        }
        if let Some(installed) = previous
            .as_ref()
            .filter(|p| version(&p.manifest.version) > version(&manifest.version))
        {
            return fail_with(
                format!(
                    "A versão {} é mais antiga que a instalada ({}); remova o plugin para voltar",
                    manifest.version, installed.manifest.version
                ),
                409,
            );
        }
        let mut saved = None;
        self.repo.transaction_dyn(&mut || {
            self.sync_skills(previous.as_ref().map(|p| &p.manifest), Some(&manifest))?;
            saved = Some(self.repo.save_plugin(&manifest, false)?);
            Ok(())
        })?;
        match saved {
            Some(plugin) => self.view(plugin),
            None => fail("Plugin não instalado"),
        }
    }

    pub fn remove(&self, actor: &Actor, id: &str) -> Result<()> {
        require_admin(actor)?;
        let plugin = self.find(id)?;
        if plugin.builtin {
            return fail_with("Plugins do próprio app não podem ser removidos; desative-o", 422);
        }
        self.repo.transaction_dyn(&mut || {
            self.sync_skills(Some(&plugin.manifest), None)?;
            self.repo.delete_plugin(id)
        })
    }

    pub fn set_enabled(&self, actor: &Actor, id: &str, enabled: bool) -> Result<PluginView> {
        require_admin(actor)?;
        self.find(id)?;
        self.repo.set_plugin_enabled(id, enabled)?;
        self.view(self.find(id)?)
    }

    /// Stores (sealed) or clears a credential the plugin declares.
    pub fn set_credential(&self, actor: &Actor, id: &str, name: &str, value: Option<&str>) -> Result<PluginView> {
        require_admin(actor)?;
        let plugin = self.find(id)?;
        if !plugin.manifest.credentials.iter().any(|c| c.name == name) {
            return fail_with("Credencial não declarada pelo plugin", 422);
        }
        let value = value.map(str::trim).filter(|v| !v.is_empty());
        if value.is_some_and(|v| v.len() > 4000) {
            return fail("Credencial longa demais");
        }
        let sealed = value.map(|v| self.secrets.seal(v)).transpose()?;
        self.repo.set_plugin_credential(id, name, sealed.as_deref())?;
        self.view(plugin)
    }

    /// The enabled plugin that serves `name` (`<plugin>.<tool>`) and the tool.
    fn locate(&self, name: &str) -> Result<(Manifest, PluginTool)> {
        let Some((plugin_id, tool_name)) = name.split_once('.') else {
            return fail(format!("Ferramenta desconhecida: {name}"));
        };
        let plugin = self.repo.plugin(plugin_id)?.filter(|p| p.enabled);
        let Some(plugin) = plugin else {
            return fail(format!("O plugin {plugin_id} não está instalado ou está desativado"));
        };
        let tool = plugin.manifest.tools.iter().find(|t| t.name == tool_name).cloned();
        match tool {
            Some(tool) => Ok((plugin.manifest, tool)),
            None => fail(format!("Ferramenta desconhecida: {name}")),
        }
    }

    fn bearer(&self, manifest: &Manifest, tool: &PluginTool) -> Result<Option<String>> {
        let Some(name) = &tool.endpoint.credential else {
            return Ok(None);
        };
        match self.repo.plugin_credential(&manifest.id, name)? {
            Some(sealed) => self.secrets.open(&sealed).map(Some),
            None => fail(format!("Configure a credencial {name} do plugin {}", manifest.name)),
        }
    }
}

#[async_trait]
impl BusinessTools for PluginService {
    fn tools(&self, _account_id: i64) -> Vec<ToolDef> {
        let plugins = self.repo.plugins().unwrap_or_default();
        plugins
            .iter()
            .filter(|p| p.enabled)
            .flat_map(|p| p.manifest.tools.iter().map(|tool| from_plugin(&p.manifest, tool)))
            .collect()
    }

    async fn call(&self, account_id: i64, name: &str, args: &Value) -> Result<Value> {
        let (manifest, tool) = self.locate(name)?;
        let endpoint = &tool.endpoint;
        match endpoint.kind {
            EndpointKind::Builtin => match self.builtins.get(&manifest.id) {
                Some(handler) => handler.call(account_id, &tool.name, args).await,
                None => fail(format!("Ferramenta indisponível: {name}")),
            },
            EndpointKind::Http => {
                let bearer = self.bearer(&manifest, &tool)?;
                self.transport.http(&endpoint.url, bearer.as_deref(), args).await
            }
            EndpointKind::Mcp => {
                let bearer = self.bearer(&manifest, &tool)?;
                let remote = endpoint.remote_name.as_deref().unwrap_or(&tool.name);
                self.transport.mcp(&endpoint.url, bearer.as_deref(), remote, args).await
            }
        }
    }
}
