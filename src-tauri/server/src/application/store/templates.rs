//! Agent templates: what one brings (preview) and installing it in one step. Installing downloads
//! the plugin (or updates it), fills in the credentials given, creates the AI agent with the
//! plugin's skills, connects it to an inbox (optional), grants the template's tools and creates
//! its routines. What could not be done (the engine is off, a credential is missing) comes back as
//! a pending item, never as a half-done error.
use super::StoreService;
use crate::application::agent_schedules::ScheduleFields;
use crate::application::engine::EngineService;
use crate::application::plugins::PluginView;
use crate::domain::actor::Actor;
use crate::domain::error::{fail, fail_with, Result};
use crate::domain::helpdesk::require_admin;
use crate::domain::model::{RosterAgent, RosterAgentDraft};
use crate::domain::plugins::{Manifest, PluginSchedule};
use crate::domain::store::{AgentTemplate, StorePlugin};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// The template and what its plugin brings, before installing.
#[derive(Debug, Serialize)]
pub struct TemplatePreview {
    pub template: AgentTemplate,
    pub plugin: StorePlugin,
    pub manifest: Manifest,
    /// Credentials that already have a value here (the plugin is installed).
    pub credentials_set: Vec<String>,
}

#[derive(Debug, Default, Deserialize)]
pub struct AgentRequest {
    /// The agent's name (the template's by default).
    pub name: Option<String>,
    /// Credential values for the plugin; blank ones keep what is stored.
    #[serde(default)]
    pub credentials: BTreeMap<String, String>,
    /// The inbox the new agent answers.
    pub inbox_id: Option<i64>,
}

#[derive(Debug, Serialize)]
pub struct AgentInstall {
    pub agent: RosterAgent,
    pub plugin: PluginView,
    pub granted: Vec<String>,
    pub routines: Vec<String>,
    /// What the administrator still has to do, in plain words.
    pub pending: Vec<String>,
}

impl StoreService {
    async fn template(&self, id: &str) -> Result<(AgentTemplate, StorePlugin, Manifest)> {
        let (_, catalog) = self.load().await?;
        let Some(template) = catalog.agent(id).cloned() else {
            return fail_with("Este modelo de agente não está na loja", 404);
        };
        let Some(plugin) = catalog.plugin(&template.plugin).cloned() else {
            return fail("O plugin do modelo não está na loja");
        };
        let manifest = self.plugins.preview(&plugin.url).await?;
        if manifest.id != plugin.id {
            return fail(format!(
                "O endereço de {} traz outro plugin ({})",
                plugin.id, manifest.id
            ));
        }
        template.check(&manifest)?;
        Ok((template, plugin, manifest))
    }

    pub async fn preview_agent(&self, actor: &Actor, id: &str) -> Result<TemplatePreview> {
        require_admin(actor)?;
        let (template, plugin, manifest) = self.template(id).await?;
        let credentials_set = self.repo.plugin_credential_names(&manifest.id)?;
        Ok(TemplatePreview {
            template,
            plugin,
            manifest,
            credentials_set,
        })
    }

    fn profile(&self, role: &str) -> Result<i64> {
        let profiles = self.repo.custom_roles()?;
        match profiles.iter().find(|p| p.agent_role.as_deref() == Some(role)) {
            Some(profile) => Ok(profile.id),
            None => fail(format!("Crie em Perfis um perfil com a função {role} para este agente")),
        }
    }

    pub async fn install_agent(&self, actor: &Actor, id: &str, request: &AgentRequest) -> Result<AgentInstall> {
        require_admin(actor)?;
        let (template, plugin, manifest) = self.template(id).await?;
        for name in request.credentials.keys() {
            if !manifest.credentials.iter().any(|c| &c.name == name) {
                return fail_with(format!("Credencial não declarada pelo plugin: {name}"), 422);
            }
        }
        let name = request.name.as_deref().map(str::trim).filter(|n| !n.is_empty());
        let draft = RosterAgentDraft {
            id: 0,
            name: name.unwrap_or(&template.agent_name).to_string(),
            kind: "ai".into(),
            role: String::new(),
            profile_id: Some(self.profile(&template.role)?),
            description: Some(template.description.clone()).filter(|d| !d.trim().is_empty()),
            user_id: None,
            whatsapp_jid: None,
            runtime: Some(template.runtime.clone()),
            model: template.model.clone(),
            instructions: Some(template.agent_instructions()),
            goals: None,
            active: true,
            supervisor_id: None,
        };
        if draft.name.chars().count() > 80 {
            return fail("O nome do agente tem até 80 caracteres");
        }

        let mut view = self.plugins.install_from(actor, &plugin.url).await?;
        for (credential, value) in request.credentials.iter().filter(|(_, v)| !v.trim().is_empty()) {
            view = self
                .plugins
                .set_credential(actor, &manifest.id, credential, Some(value))?;
        }
        let mut pending: Vec<String> = manifest
            .credentials
            .iter()
            .filter(|c| !view.credentials_set.contains(&c.name))
            .map(|c| format!("Preencha a credencial {} em Plugins", c.name))
            .collect();
        let mut agent = self.agents.save_agent(actor, &draft)?;
        let wanted: Vec<String> = manifest.skills.iter().map(|s| manifest.skill_name(s)).collect();
        let skill_ids: Vec<i64> = self
            .agents
            .skills(actor)?
            .iter()
            .filter(|s| wanted.iter().any(|w| w.eq_ignore_ascii_case(&s.name)))
            .map(|s| s.id)
            .collect();
        if !skill_ids.is_empty() {
            agent = self.agents.set_agent_skills(actor, agent.id, &skill_ids)?;
        }
        if let Some(inbox) = request.inbox_id {
            if let Err(error) = self.agents.connect_inbox(actor, inbox, Some(agent.id)) {
                pending.push(format!("Ligue o agente a uma caixa em Canais ({error})"));
            }
        }
        let granted = self.grant(actor, &template, agent.id, &mut pending);
        let mut routines = Vec::new();
        for schedule in manifest
            .schedules
            .iter()
            .filter(|s| template.schedules.contains(&s.name))
        {
            match self.routine(actor, &manifest, schedule, agent.id) {
                Ok(name) => routines.push(name),
                Err(error) => pending.push(format!("Crie a rotina “{}” em Plugins ({error})", schedule.name)),
            }
        }
        Ok(AgentInstall {
            agent,
            plugin: view,
            granted,
            routines,
            pending,
        })
    }

    fn grant(&self, actor: &Actor, template: &AgentTemplate, agent: i64, pending: &mut Vec<String>) -> Vec<String> {
        let Some(engine) = self.engine.get() else {
            if !template.tools.is_empty() {
                pending.push("Ligue o motor de agentes e libere as ferramentas em Motor de agentes".into());
            }
            return Vec::new();
        };
        let mut granted = Vec::new();
        for grant in &template.tools {
            let done = EngineService::account_of(actor)
                .and_then(|account| engine.grant(account, agent, &grant.tool, Some(&grant.effect)));
            match done {
                Ok(_) => granted.push(grant.tool.clone()),
                Err(error) => pending.push(format!("Libere {} em Motor de agentes ({error})", grant.tool)),
            }
        }
        granted
    }

    fn routine(&self, actor: &Actor, manifest: &Manifest, schedule: &PluginSchedule, agent: i64) -> Result<String> {
        let name = format!("{}: {}", manifest.name, schedule.name);
        let fields = ScheduleFields {
            name: Some(name.clone()),
            cron: Some(Some(schedule.cron.clone())),
            prompt: Some(schedule.prompt.clone()),
            agent_ids: Some(vec![agent]),
            ..Default::default()
        };
        self.schedules.create(actor, &fields)?;
        Ok(name)
    }
}
