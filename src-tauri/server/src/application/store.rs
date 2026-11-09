//! The store (administrators): reads the catalog at the account's address, shows each skill and
//! agent template with what is already installed here, installs skills (plugins by address) and
//! creates agents from templates. It only uses the other services; it has no tables of its own.
mod templates;

use super::agent_schedules::AgentScheduleService;
use super::agents::AgentDirectory;
use super::engine::EngineService;
use super::plugins::{PluginService, PluginView};
use super::ports::Repository;
use crate::domain::actor::Actor;
use crate::domain::error::{fail, fail_with, Result};
use crate::domain::helpdesk::require_admin;
use crate::domain::plugins::{allowed_url, version};
use crate::domain::store::{parse_catalog, AgentTemplate, Catalog, StorePlugin, CATALOG_KEY, DEFAULT_CATALOG};
use serde::Serialize;
use serde_json::{json, Value};
use std::sync::{Arc, OnceLock};

pub use templates::{AgentInstall, AgentRequest, TemplatePreview};

#[derive(Clone)]
pub struct StoreService {
    pub repo: Arc<dyn Repository>,
    pub plugins: PluginService,
    pub agents: AgentDirectory,
    pub schedules: AgentScheduleService,
    pub engine: Arc<OnceLock<EngineService>>,
}

/// What is installed here of a store skill.
#[derive(Debug, Serialize)]
pub struct Installed {
    pub version: String,
    pub enabled: bool,
    /// The store has a newer version.
    pub update: bool,
    pub credentials_missing: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct PluginCard {
    #[serde(flatten)]
    pub plugin: StorePlugin,
    pub installed: Option<Installed>,
}

#[derive(Debug, Serialize)]
pub struct AgentCard {
    #[serde(flatten)]
    pub template: AgentTemplate,
    /// The plugin the template installs, as installed here.
    pub plugin_installed: Option<Installed>,
}

#[derive(Debug, Serialize)]
pub struct StoreView {
    pub name: String,
    /// The address read, and whether it is the app's default.
    pub source: String,
    pub default_source: bool,
    pub plugins: Vec<PluginCard>,
    pub agents: Vec<AgentCard>,
}

impl StoreService {
    /// The catalog address: the account's, else the app's default.
    pub fn source(&self) -> Result<String> {
        let settings = self.repo.account()?.settings;
        Ok(settings[CATALOG_KEY]
            .as_str()
            .filter(|s| !s.trim().is_empty())
            .unwrap_or(DEFAULT_CATALOG)
            .to_string())
    }

    /// Points the store at another catalog (`None` goes back to the default).
    pub fn set_source(&self, actor: &Actor, url: Option<&str>) -> Result<String> {
        require_admin(actor)?;
        let url = url.map(str::trim).filter(|u| !u.is_empty());
        if url.is_some_and(|u| !allowed_url(u) || u.len() > 500) {
            return fail("Endereço da loja: use HTTPS (HTTP só local)");
        }
        let mut settings = self.repo.account()?.settings;
        if !settings.is_object() {
            settings = json!({});
        }
        settings[CATALOG_KEY] = url.map_or(Value::Null, |u| json!(u));
        self.repo.update_account(None, None, Some(&settings))?;
        self.source()
    }

    async fn load(&self) -> Result<(String, Catalog)> {
        let source = self.source()?;
        let json = match self.plugins.fetch_json(&source).await {
            Ok(json) => json,
            Err(error) => return fail_with(format!("Não consegui ler a loja em {source}: {error}"), 502),
        };
        Ok((source.clone(), parse_catalog(&json, &source)?))
    }

    fn installed(&self, id: &str, store_version: &str) -> Result<Option<Installed>> {
        let Some(plugin) = self.repo.plugin(id)? else {
            return Ok(None);
        };
        let set = self.repo.plugin_credential_names(id)?;
        let manifest = &plugin.manifest;
        Ok(Some(Installed {
            version: manifest.version.clone(),
            enabled: plugin.enabled,
            update: version(store_version) > version(&manifest.version),
            credentials_missing: manifest
                .credentials
                .iter()
                .filter(|c| !set.contains(&c.name))
                .map(|c| c.name.clone())
                .collect(),
        }))
    }

    pub async fn catalog(&self, actor: &Actor) -> Result<StoreView> {
        require_admin(actor)?;
        let (source, catalog) = self.load().await?;
        let plugins = catalog
            .plugins
            .iter()
            .map(|p| {
                Ok(PluginCard {
                    installed: self.installed(&p.id, &p.version)?,
                    plugin: p.clone(),
                })
            })
            .collect::<Result<_>>()?;
        let agents = catalog
            .agents
            .iter()
            .map(|t| {
                let store_version = catalog.plugin(&t.plugin).map_or("", |p| p.version.as_str());
                Ok(AgentCard {
                    plugin_installed: self.installed(&t.plugin, store_version)?,
                    template: t.clone(),
                })
            })
            .collect::<Result<_>>()?;
        Ok(StoreView {
            name: catalog.name,
            default_source: source == DEFAULT_CATALOG,
            source,
            plugins,
            agents,
        })
    }

    /// Installs or updates a store skill from its address.
    pub async fn install_plugin(&self, actor: &Actor, id: &str) -> Result<PluginView> {
        require_admin(actor)?;
        let (_, catalog) = self.load().await?;
        match catalog.plugin(id) {
            Some(plugin) => self.plugins.install_from(actor, &plugin.url).await,
            None => fail_with("Esta habilidade não está na loja", 404),
        }
    }
}
