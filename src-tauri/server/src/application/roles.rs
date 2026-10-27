//! Profiles (Chatwoot custom roles): every agent has one. A profile sets the permissions and, for AI
//! agents, the AI role they play; the built-in "Padrão" keeps the default access and cannot be deleted.
use super::accounts::AccountService;
use crate::domain::actor::Actor;
use crate::domain::agents::{executes, holds_credentials, ROLES};
use crate::domain::error::{fail, fail_with, HelpdeskError, Result};
use crate::domain::helpdesk::require_admin;
use crate::domain::model::CustomRole;
use crate::domain::roles::PERMISSIONS;

impl AccountService {
    pub fn custom_roles(&self, actor: &Actor) -> Result<Vec<CustomRole>> {
        require_admin(actor)?;
        self.core.repo.custom_roles()
    }

    pub(super) fn find_role(&self, id: i64) -> Result<CustomRole> {
        self.core
            .repo
            .custom_role(id)?
            .ok_or_else(|| HelpdeskError::not_found("Perfil não encontrado").into())
    }

    /// Creates (`id` 0) or replaces a profile after checking the name, permissions, AI role and
    /// skills (`None` keeps the current ones). Only roles that execute carry skills.
    pub fn save_custom_role(&self, actor: &Actor, role: &CustomRole, skills: Option<&[i64]>) -> Result<CustomRole> {
        require_admin(actor)?;
        if role.permissions.is_empty() || role.permissions.iter().any(|p| !PERMISSIONS.contains(&p.as_str())) {
            return fail("Escolha permissões válidas");
        }
        if role.agent_role.as_deref().is_some_and(|r| !ROLES.contains(&r)) {
            return fail("Função de IA inválida");
        }
        let mut role = role.clone();
        role.skill_ids = skills.map(<[i64]>::to_vec).unwrap_or_default();
        if role.id != 0 {
            let current = self.find_role(role.id)?;
            role.builtin = current.builtin;
            if skills.is_none() {
                role.skill_ids = current.skill_ids.clone();
            }
            if current.agent_role != role.agent_role {
                self.check_ai_agents(&role)?;
            }
        }
        if self.core.repo.role_name_taken(&role.name, role.id)? {
            return fail_with("Já existe um perfil com este nome", 422);
        }
        if !role.skill_ids.is_empty() && !executes(role.agent_role.as_deref().unwrap_or_default()) {
            return fail("Só perfis com função que executa (não coordenador) têm skills");
        }
        for skill in &role.skill_ids {
            if self.core.repo.skill(*skill)?.is_none() {
                return fail_with("Skill não encontrada", 422);
            }
        }
        role.permissions.dedup();
        role.skill_ids.sort_unstable();
        role.skill_ids.dedup();
        self.core.repo.save_custom_role(&role)
    }

    /// The agents of a profile must stay valid: AI agents keep a role, agents with skills keep a role
    /// that executes, and AI agents with credentials too (coordinators never execute).
    fn check_ai_agents(&self, role: &CustomRole) -> Result<()> {
        let next = role.agent_role.as_deref().unwrap_or_default();
        for agent in self.core.repo.agents()? {
            if agent.profile_id != Some(role.id) {
                continue;
            }
            if agent.kind == "ai" && next.is_empty() {
                return fail(format!(
                    "O agente de IA {} usa este perfil: mantenha uma função",
                    agent.name
                ));
            }
            let skills = !agent.skill_ids.is_empty() && !executes(next);
            let credentials = agent.credential_count > 0 && !holds_credentials(&agent.kind, next);
            if skills || credentials {
                return fail(format!(
                    "O agente {} tem skills ou credenciais e esta função não executa tarefas",
                    agent.name
                ));
            }
        }
        Ok(())
    }

    /// Users and people of a deleted profile move to "Padrão"; AI agents must be moved first.
    pub fn delete_custom_role(&self, actor: &Actor, id: i64) -> Result<()> {
        require_admin(actor)?;
        if self.find_role(id)?.builtin {
            return fail_with("O perfil Padrão não pode ser excluído", 409);
        }
        let ai = self.core.repo.agents()?;
        if let Some(agent) = ai.iter().find(|a| a.kind == "ai" && a.profile_id == Some(id)) {
            return fail_with(
                format!(
                    "O agente de IA {} usa este perfil: troque o perfil dele antes",
                    agent.name
                ),
                409,
            );
        }
        self.core.repo.delete_custom_role(id)
    }
}
