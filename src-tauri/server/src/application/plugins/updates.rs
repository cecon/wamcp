//! Plugins installed from an address (`https://…/plugin.json`) remember it, so an update is one
//! click: the manifest is fetched again and installed when its version is newer. The credentials,
//! the on/off state and the agents' grants stay.
use super::{PluginService, PluginView};
use crate::domain::actor::Actor;
use crate::domain::error::{fail_with, Result};
use crate::domain::helpdesk::require_admin;
use crate::domain::plugins::version;
use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct UpdateOutcome {
    /// `false`: the installed version is already the newest.
    pub updated: bool,
    pub previous_version: String,
    pub plugin: PluginView,
}

impl PluginService {
    /// Downloads the manifest at `url` and installs it (or updates it).
    pub async fn install_from(&self, actor: &Actor, url: &str) -> Result<PluginView> {
        require_admin(actor)?;
        let url = url.trim();
        let json = self.transport.manifest(url).await?;
        let view = self.install(actor, &json)?;
        self.repo.set_plugin_source(&view.plugin.manifest.id, Some(url))?;
        self.view(self.find(&view.plugin.manifest.id)?)
    }

    /// Fetches the plugin's address again and installs a newer version, if there is one.
    pub async fn update(&self, actor: &Actor, id: &str) -> Result<UpdateOutcome> {
        require_admin(actor)?;
        let plugin = self.find(id)?;
        let Some(source) = plugin.source.clone() else {
            return fail_with(
                "Este plugin não foi instalado por um endereço; instale a versão nova pelo manifesto",
                422,
            );
        };
        let json = self.transport.manifest(&source).await?;
        let fetched = crate::domain::plugins::parse(&json, false)?;
        if fetched.id != plugin.manifest.id {
            return fail_with(format!("O endereço agora traz outro plugin ({})", fetched.id), 409);
        }
        let previous_version = plugin.manifest.version.clone();
        if version(&fetched.version) <= version(&previous_version) {
            return Ok(UpdateOutcome {
                updated: false,
                previous_version,
                plugin: self.view(plugin)?,
            });
        }
        let plugin = self.install(actor, &json)?;
        Ok(UpdateOutcome {
            updated: true,
            previous_version,
            plugin,
        })
    }
}
