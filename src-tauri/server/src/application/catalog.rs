//! Labels (admin-managed) and canned responses (any agent), as in Chatwoot.
use super::core::Core;
use crate::domain::actor::Actor;
use crate::domain::error::{fail_with, HelpdeskError, Result};
use crate::domain::helpdesk::{normalize_label_title, require_admin, validate_canned_code};
use crate::domain::model::{CannedResponse, Label, LabelFields};

#[derive(Clone)]
pub struct CatalogService {
    pub core: Core,
}

impl CatalogService {
    fn find_label(&self, id: i64) -> Result<Label> {
        self.core
            .repo
            .label(id)?
            .ok_or_else(|| HelpdeskError::not_found("Etiqueta não encontrada").into())
    }

    fn find_canned(&self, id: i64) -> Result<CannedResponse> {
        self.core
            .repo
            .canned_response(id)?
            .ok_or_else(|| HelpdeskError::not_found("Resposta pronta não encontrada").into())
    }

    pub fn labels(&self) -> Result<Vec<Label>> {
        self.core.repo.labels()
    }

    pub fn create_label(&self, actor: &Actor, fields: &LabelFields) -> Result<Label> {
        require_admin(actor)?;
        let title = normalize_label_title(fields.title.as_deref().unwrap_or_default())?;
        if self.core.repo.label_by_title(&title, 0)?.is_some() {
            return fail_with("Etiqueta já existe", 409);
        }
        let label = self.core.repo.create_label(&title, fields)?;
        self.core.emit("label.created", &label, None);
        Ok(label)
    }

    pub fn update_label(&self, actor: &Actor, id: i64, fields: &LabelFields) -> Result<Label> {
        require_admin(actor)?;
        self.find_label(id)?;
        let title = fields.title.as_deref().map(normalize_label_title).transpose()?;
        if let Some(title) = &title {
            if self.core.repo.label_by_title(title, id)?.is_some() {
                return fail_with("Etiqueta já existe", 409);
            }
        }
        self.core.repo.update_label(id, title.as_deref(), fields)
    }

    pub fn delete_label(&self, actor: &Actor, id: i64) -> Result<()> {
        require_admin(actor)?;
        self.find_label(id)?;
        self.core.repo.delete_label(id)
    }

    pub fn canned_responses(&self, q: &str) -> Result<Vec<CannedResponse>> {
        self.core.repo.canned_responses(q)
    }

    pub fn create_canned(&self, short_code: &str, content: &str) -> Result<CannedResponse> {
        let code = validate_canned_code(short_code)?;
        if self.core.repo.canned_by_code(&code, 0)?.is_some() {
            return fail_with("Atalho já existe", 409);
        }
        self.core.repo.create_canned(&code, content)
    }

    pub fn update_canned(&self, id: i64, short_code: Option<&str>, content: Option<&str>) -> Result<CannedResponse> {
        self.find_canned(id)?;
        let code = short_code.map(validate_canned_code).transpose()?;
        if let Some(code) = &code {
            if self.core.repo.canned_by_code(code, id)?.is_some() {
                return fail_with("Atalho já existe", 409);
            }
        }
        self.core.repo.update_canned(id, code.as_deref(), content)
    }

    pub fn delete_canned(&self, actor: &Actor, id: i64) -> Result<()> {
        require_admin(actor)?;
        self.find_canned(id)?;
        self.core.repo.delete_canned(id)
    }
}
