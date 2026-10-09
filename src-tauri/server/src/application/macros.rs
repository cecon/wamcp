//! Macros: saved action sequences an agent runs on one or more conversations. Personal macros
//! belong to their author; global ones are shared and managed by administrators.
use super::bulk::{BulkFailure, BulkResult};
use super::helpdesk::HelpdeskService;
use crate::domain::actor::Actor;
use crate::domain::automation::validate_actions;
use crate::domain::error::{fail, fail_with, Error, HelpdeskError, Result};
use crate::domain::model::{Action, Macro};

pub const VISIBILITIES: [&str; 2] = ["personal", "global"];

/// Fields of a macro; `None` keeps the current value on update.
#[derive(Debug, Clone, Default)]
pub struct MacroFields {
    pub name: Option<String>,
    pub visibility: Option<String>,
    pub actions: Option<Vec<Action>>,
}

fn message(error: Error) -> String {
    match error {
        Error::Helpdesk(e) => e.message,
        Error::Internal(_) => "Falha ao executar".into(),
    }
}

impl HelpdeskService {
    fn user_of(actor: &Actor) -> Result<i64> {
        actor
            .user_id()
            .map_or_else(|| fail_with("Somente agentes usam macros", 403), Ok)
    }

    fn visible_macro(&self, actor: &Actor, id: i64) -> Result<Macro> {
        let user = Self::user_of(actor)?;
        match self.core.repo.macro_by_id(id)? {
            Some(m) if m.visibility == "global" || m.created_by == Some(user) => Ok(m),
            _ => Err(HelpdeskError::not_found("Macro não encontrada").into()),
        }
    }

    /// Global macros are managed by administrators; personal ones by their author.
    fn editable_macro(&self, actor: &Actor, id: i64) -> Result<Macro> {
        let found = self.visible_macro(actor, id)?;
        if found.visibility == "global" && !actor.is_admin() {
            return fail_with("Somente administradores alteram macros globais", 403);
        }
        Ok(found)
    }

    fn check_visibility(actor: &Actor, visibility: Option<&str>) -> Result<()> {
        if visibility == Some("global") && !actor.is_admin() {
            return fail_with("Somente administradores criam macros globais", 403);
        }
        Ok(())
    }

    pub fn macros(&self, actor: &Actor) -> Result<Vec<Macro>> {
        self.core.repo.macros(Self::user_of(actor)?)
    }

    pub fn create_macro(&self, actor: &Actor, fields: &MacroFields) -> Result<Macro> {
        let user = Self::user_of(actor)?;
        let visibility = fields.visibility.as_deref().unwrap_or("personal");
        Self::check_visibility(actor, Some(visibility))?;
        let actions = fields.actions.clone().unwrap_or_default();
        validate_actions(&actions)?;
        let name = fields.name.clone().unwrap_or_default();
        self.core.repo.create_macro(&name, visibility, user, &actions)
    }

    pub fn update_macro(&self, actor: &Actor, id: i64, fields: &MacroFields) -> Result<Macro> {
        self.editable_macro(actor, id)?;
        Self::check_visibility(actor, fields.visibility.as_deref())?;
        if let Some(actions) = &fields.actions {
            validate_actions(actions)?;
        }
        self.core.repo.update_macro(
            id,
            fields.name.as_deref(),
            fields.visibility.as_deref(),
            fields.actions.as_deref(),
        )
    }

    pub fn delete_macro(&self, actor: &Actor, id: i64) -> Result<()> {
        self.editable_macro(actor, id)?;
        self.core.repo.delete_macro(id)
    }

    /// Runs the macro on each conversation as the agent; a conversation fails with its first error.
    pub async fn execute_macro(&self, actor: &Actor, id: i64, display_ids: &[i64]) -> Result<BulkResult> {
        let found = self.visible_macro(actor, id)?;
        if display_ids.is_empty() || display_ids.len() > 100 {
            return fail("Selecione de 1 a 100 conversas");
        }
        let mut result = BulkResult::default();
        for display_id in display_ids {
            match self
                .run_actions(actor, *display_id, &found.actions)
                .await
                .into_iter()
                .next()
            {
                None => result.updated.push(*display_id),
                Some(error) => result.failed.push(BulkFailure {
                    id: *display_id,
                    error: message(error),
                }),
            }
        }
        Ok(result)
    }
}
