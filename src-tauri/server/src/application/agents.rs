//! The agent roster (administrators): human and AI agents with their roles, the skill library
//! (including `SKILL.md` import) and encrypted credentials. Nothing here runs an agent yet.
use super::core::Core;
use super::ports::SecretBox;
use crate::domain::actor::Actor;
use crate::domain::agents::{
    check_capabilities, executes, parse_skill_md, validate_agent, validate_credential_name, validate_tools,
    CREDENTIAL_KINDS,
};
use crate::domain::error::{fail, fail_with, HelpdeskError, Result};
use crate::domain::helpdesk::require_admin;
use crate::domain::model::{AgentCredential, RosterAgent, RosterAgentDraft, Skill};
use std::sync::Arc;

#[derive(Clone)]
pub struct AgentDirectory {
    pub core: Core,
    pub secrets: Arc<dyn SecretBox>,
}

impl AgentDirectory {
    fn find_agent(&self, id: i64) -> Result<RosterAgent> {
        self.core
            .repo
            .agent(id)?
            .ok_or_else(|| HelpdeskError::not_found("Agente não encontrado").into())
    }

    fn find_skill(&self, id: i64) -> Result<Skill> {
        self.core
            .repo
            .skill(id)?
            .ok_or_else(|| HelpdeskError::not_found("Skill não encontrada").into())
    }

    pub fn agents(&self, actor: &Actor) -> Result<Vec<RosterAgent>> {
        require_admin(actor)?;
        self.core.repo.agents()
    }

    /// Creates (`id` 0) or replaces an agent; its kind never changes after creation.
    pub fn save_agent(&self, actor: &Actor, draft: &RosterAgentDraft) -> Result<RosterAgent> {
        require_admin(actor)?;
        let mut draft = draft.clone();
        draft.role = self.role_from_profile(&draft)?;
        let draft = &draft;
        validate_agent(draft)?;
        if draft.id != 0 {
            let current = self.find_agent(draft.id)?;
            if current.kind != draft.kind {
                return fail("O tipo do agente não pode mudar; crie outro agente");
            }
            check_capabilities(draft, current.skill_ids.len(), current.credential_count)?;
        }
        if let Some(user_id) = draft.user_id {
            if self.core.repo.user(user_id)?.is_none() {
                return fail_with("Login não encontrado", 422);
            }
        }
        self.core.repo.save_agent(draft)
    }

    /// The AI role comes from the mandatory profile; AI agents need a profile with an AI role.
    fn role_from_profile(&self, draft: &RosterAgentDraft) -> Result<String> {
        let Some(id) = draft.profile_id else {
            return fail("Escolha o perfil do agente");
        };
        let Some(profile) = self.core.repo.custom_role(id)? else {
            return fail_with("Perfil não encontrado", 422);
        };
        match (draft.kind.as_str(), profile.agent_role) {
            ("ai", None) => fail("Agentes de IA precisam de um perfil com função de IA (coordenador, operador…)"),
            (_, Some(role)) => Ok(role),
            (_, None) => Ok("operator".into()),
        }
    }

    pub fn delete_agent(&self, actor: &Actor, id: i64) -> Result<()> {
        require_admin(actor)?;
        self.find_agent(id)?;
        self.core.repo.delete_agent(id)
    }

    /// Replaces the agent's skills (only agents that execute may have them).
    pub fn set_agent_skills(&self, actor: &Actor, id: i64, skill_ids: &[i64]) -> Result<RosterAgent> {
        require_admin(actor)?;
        let agent = self.find_agent(id)?;
        if !skill_ids.is_empty() && !executes(&agent.kind, &agent.role) {
            return fail("Somente agentes de IA que executam (não coordenadores) têm skills");
        }
        for skill in skill_ids {
            self.find_skill(*skill)?;
        }
        self.core.repo.set_agent_skills(id, skill_ids)?;
        self.find_agent(id)
    }

    pub fn skills(&self, actor: &Actor) -> Result<Vec<Skill>> {
        require_admin(actor)?;
        self.core.repo.skills()
    }

    /// Creates (`id` 0) or replaces a skill.
    pub fn save_skill(&self, actor: &Actor, skill: &Skill) -> Result<Skill> {
        require_admin(actor)?;
        if skill.id != 0 {
            self.find_skill(skill.id)?;
        }
        validate_tools(&skill.tools)?;
        if self.core.repo.skill_name_taken(&skill.name, skill.id)? {
            return fail_with("Já existe uma skill com este nome", 422);
        }
        let mut skill = skill.clone();
        skill.tools.dedup();
        self.core.repo.save_skill(&skill)
    }

    /// Creates a skill from a Claude Code style `SKILL.md`.
    pub fn import_skill(&self, actor: &Actor, content: &str) -> Result<Skill> {
        let skill = parse_skill_md(content)?;
        if skill.name.chars().count() > 80 {
            return fail("Nome da skill com mais de 80 caracteres");
        }
        self.save_skill(actor, &skill)
    }

    pub fn delete_skill(&self, actor: &Actor, id: i64) -> Result<()> {
        require_admin(actor)?;
        self.find_skill(id)?;
        self.core.repo.delete_skill(id)
    }

    pub fn agent_credentials(&self, actor: &Actor, agent_id: i64) -> Result<Vec<AgentCredential>> {
        require_admin(actor)?;
        self.find_agent(agent_id)?;
        self.core.repo.agent_credentials(agent_id)
    }

    /// Stores a secret encrypted; it can be replaced or removed, never read back through the API.
    pub fn add_agent_credential(
        &self,
        actor: &Actor,
        agent_id: i64,
        name: &str,
        kind: &str,
        secret: &str,
    ) -> Result<AgentCredential> {
        require_admin(actor)?;
        let agent = self.find_agent(agent_id)?;
        if !executes(&agent.kind, &agent.role) {
            return fail("Somente agentes de IA que executam (não coordenadores) têm credenciais");
        }
        validate_credential_name(name)?;
        if !CREDENTIAL_KINDS.contains(&kind) {
            return fail("Tipo de credencial inválido");
        }
        if secret.is_empty() {
            return fail("Informe o segredo da credencial");
        }
        if self.core.repo.agent_credential_name_taken(agent_id, name)? {
            return fail_with("Este agente já tem uma credencial com este nome", 422);
        }
        let sealed = self.secrets.seal(secret)?;
        self.core.repo.add_agent_credential(agent_id, name, kind, &sealed)
    }

    pub fn delete_agent_credential(&self, actor: &Actor, agent_id: i64, id: i64) -> Result<()> {
        require_admin(actor)?;
        if !self.core.repo.delete_agent_credential(agent_id, id)? {
            return Err(HelpdeskError::not_found("Credencial não encontrada").into());
        }
        Ok(())
    }
}
