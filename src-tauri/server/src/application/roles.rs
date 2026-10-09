//! Custom roles: administrators define permission sets and assign them to agents.
use super::accounts::AccountService;
use crate::domain::actor::Actor;
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

    /// Creates (`id` 0) or replaces a role after checking the name and permissions.
    pub fn save_custom_role(&self, actor: &Actor, role: &CustomRole) -> Result<CustomRole> {
        require_admin(actor)?;
        if role.id != 0 {
            self.find_role(role.id)?;
        }
        if role.permissions.is_empty() || role.permissions.iter().any(|p| !PERMISSIONS.contains(&p.as_str())) {
            return fail("Escolha permissões válidas");
        }
        if self.core.repo.role_name_taken(&role.name, role.id)? {
            return fail_with("Já existe um perfil com este nome", 422);
        }
        let mut role = role.clone();
        role.permissions.dedup();
        self.core.repo.save_custom_role(&role)
    }

    /// Agents with the role go back to the default agent access.
    pub fn delete_custom_role(&self, actor: &Actor, id: i64) -> Result<()> {
        require_admin(actor)?;
        self.find_role(id)?;
        self.core.repo.delete_custom_role(id)
    }
}
