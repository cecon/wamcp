//! Advanced filters, saved views (custom filters) and custom attributes on conversations and contacts.
use super::helpdesk::HelpdeskService;
use crate::domain::actor::Actor;
use crate::domain::error::{fail, fail_with, HelpdeskError, Result};
use crate::domain::filters::{attribute_key, validate_filter, validate_value, ATTRIBUTE_MODELS, DISPLAY_TYPES};
use crate::domain::helpdesk::require_admin;
use crate::domain::model::{
    AttributeDefinition, AttributeFields, Condition, Contact, Conversation, CustomFilter, FilterQuery,
};
use regex::Regex;
use serde_json::{Map, Value};

/// A new definition as submitted (the key defaults to the display name).
#[derive(Debug, Clone, Default)]
pub struct NewDefinition {
    pub display_name: String,
    pub key: Option<String>,
    pub model: String,
    pub display_type: String,
    pub fields: AttributeFields,
}

/// Chatwoot stores a view's conditions as `{"payload": [...]}`.
fn conditions(query: &Value) -> Result<Vec<Condition>> {
    let payload = query.get("payload").cloned().unwrap_or(Value::Null);
    serde_json::from_value(payload).or_else(|_| fail("Filtro inválido"))
}

fn check_options(display_type: &str, values: Option<&Vec<String>>, pattern: Option<&Option<String>>) -> Result<()> {
    if let Some(values) = values {
        if values.len() > 50 || values.iter().any(|v| v.trim().is_empty() || v.chars().count() > 100) {
            return fail("A lista aceita até 50 opções de até 100 caracteres");
        }
    }
    if display_type == "list" && values.is_none_or(Vec::is_empty) {
        return fail("Informe as opções da lista");
    }
    if let Some(Some(pattern)) = pattern {
        if pattern.len() > 200 || Regex::new(pattern).is_err() {
            return fail("Expressão regular inválida");
        }
    }
    Ok(())
}

impl HelpdeskService {
    fn custom_kinds(&self, model: &str) -> Result<Vec<(String, String)>> {
        let definitions = self.core.repo.attribute_definitions(Some(model))?;
        Ok(definitions
            .into_iter()
            .map(|d| (d.attribute_key, d.attribute_display_type))
            .collect())
    }

    fn filter_query(&self, actor: &Actor, model: &str, conditions: Vec<Condition>, page: i64) -> Result<FilterQuery> {
        let custom = self.custom_kinds(model)?;
        validate_filter(model, &conditions, &custom)?;
        Ok(FilterQuery {
            conditions,
            custom,
            visible_inbox_ids: self.core.visible_inbox_ids(actor)?,
            page,
            now: self.core.now(),
        })
    }

    pub fn filter_conversations(
        &self,
        actor: &Actor,
        conditions: Vec<Condition>,
        page: i64,
    ) -> Result<Vec<Conversation>> {
        let query = self.filter_query(actor, "conversation", conditions, page)?;
        self.core.repo.filter_conversations(&query)
    }

    pub fn filter_contacts(&self, actor: &Actor, conditions: Vec<Condition>, page: i64) -> Result<Vec<Contact>> {
        let query = self.filter_query(actor, "contact", conditions, page)?;
        self.core.repo.filter_contacts(&query)
    }

    pub fn custom_filters(&self, actor: &Actor, filter_type: Option<&str>) -> Result<Vec<CustomFilter>> {
        let user = actor.user_id().unwrap_or_default();
        self.core.repo.custom_filters(user, filter_type)
    }

    fn own_filter(&self, actor: &Actor, id: i64) -> Result<CustomFilter> {
        match self.core.repo.custom_filter(id)? {
            Some(filter) if Some(filter.user_id) == actor.user_id() => Ok(filter),
            _ => Err(HelpdeskError::not_found("Visualização não encontrada").into()),
        }
    }

    pub fn create_custom_filter(
        &self,
        actor: &Actor,
        name: &str,
        filter_type: &str,
        query: &Value,
    ) -> Result<CustomFilter> {
        let Some(user) = actor.user_id() else {
            return fail_with("Somente agentes podem salvar visualizações", 403);
        };
        let model = if filter_type == "contact" {
            "contact"
        } else {
            "conversation"
        };
        validate_filter(model, &conditions(query)?, &self.custom_kinds(model)?)?;
        if self.core.repo.custom_filters(user, None)?.len() >= 50 {
            return fail("Limite de 50 visualizações atingido");
        }
        self.core.repo.create_custom_filter(user, name, filter_type, query)
    }

    pub fn update_custom_filter(
        &self,
        actor: &Actor,
        id: i64,
        name: Option<&str>,
        query: Option<&Value>,
    ) -> Result<CustomFilter> {
        let filter = self.own_filter(actor, id)?;
        if let Some(query) = query {
            let model = if filter.filter_type == "contact" {
                "contact"
            } else {
                "conversation"
            };
            validate_filter(model, &conditions(query)?, &self.custom_kinds(model)?)?;
        }
        self.core.repo.update_custom_filter(id, name, query)
    }

    pub fn delete_custom_filter(&self, actor: &Actor, id: i64) -> Result<()> {
        self.own_filter(actor, id)?;
        self.core.repo.delete_custom_filter(id)
    }

    pub fn attribute_definitions(&self, model: Option<&str>) -> Result<Vec<AttributeDefinition>> {
        self.core.repo.attribute_definitions(model)
    }

    pub fn create_attribute_definition(&self, actor: &Actor, new: NewDefinition) -> Result<AttributeDefinition> {
        require_admin(actor)?;
        if !ATTRIBUTE_MODELS.contains(&new.model.as_str()) || !DISPLAY_TYPES.contains(&new.display_type.as_str()) {
            return fail("Modelo ou tipo de atributo inválido");
        }
        let key = attribute_key(&new.display_name, new.key.as_deref())?;
        check_options(
            &new.display_type,
            new.fields.values.as_ref(),
            new.fields.regex_pattern.as_ref(),
        )?;
        if self.custom_kinds(&new.model)?.iter().any(|(k, _)| *k == key) {
            return fail_with("Já existe um atributo com esta chave", 422);
        }
        let f = new.fields;
        self.core.repo.create_attribute_definition(&AttributeDefinition {
            id: 0,
            attribute_display_name: new.display_name,
            attribute_key: key,
            attribute_model: new.model,
            attribute_display_type: new.display_type,
            attribute_description: f.description.flatten(),
            attribute_values: f.values.unwrap_or_default(),
            regex_pattern: f.regex_pattern.flatten(),
            regex_cue: f.regex_cue.flatten(),
            created: String::new(),
        })
    }

    fn definition(&self, id: i64) -> Result<AttributeDefinition> {
        self.core
            .repo
            .attribute_definition(id)?
            .ok_or_else(|| HelpdeskError::not_found("Atributo não encontrado").into())
    }

    pub fn update_attribute_definition(
        &self,
        actor: &Actor,
        id: i64,
        fields: &AttributeFields,
    ) -> Result<AttributeDefinition> {
        require_admin(actor)?;
        let current = self.definition(id)?;
        let values = fields.values.as_ref().or(Some(&current.attribute_values));
        check_options(&current.attribute_display_type, values, fields.regex_pattern.as_ref())?;
        self.core.repo.update_attribute_definition(id, fields)
    }

    pub fn delete_attribute_definition(&self, actor: &Actor, id: i64) -> Result<()> {
        require_admin(actor)?;
        self.definition(id)?;
        self.core.repo.delete_attribute_definition(id)
    }

    /// Merges `changes` into `current`: defined keys are validated, `null` removes a key.
    fn merge_attributes(&self, model: &str, current: &Value, changes: &Map<String, Value>) -> Result<Value> {
        let definitions = self.core.repo.attribute_definitions(Some(model))?;
        let mut merged = current.as_object().cloned().unwrap_or_default();
        for (key, value) in changes {
            if attribute_key(key, None)? != *key {
                return fail("Chave do atributo inválida");
            }
            if let Some(d) = definitions.iter().find(|d| d.attribute_key == *key) {
                validate_value(
                    &d.attribute_display_type,
                    &d.attribute_values,
                    d.regex_pattern.as_deref(),
                    value,
                )?;
            }
            if value.is_null() {
                merged.remove(key);
            } else {
                merged.insert(key.clone(), value.clone());
            }
        }
        if merged.len() > 50 || serde_json::to_string(&merged)?.len() > 16_384 {
            return fail("Atributos personalizados demais");
        }
        Ok(Value::Object(merged))
    }

    pub fn set_conversation_attributes(
        &self,
        actor: &Actor,
        display_id: i64,
        changes: &Map<String, Value>,
    ) -> Result<Conversation> {
        let conversation = self.core.load(Some(actor), display_id)?;
        let merged = self.merge_attributes("conversation", &conversation.custom_attributes, changes)?;
        self.core.repo.set_conversation_attributes(conversation.id, &merged)?;
        let updated = self.core.load(Some(actor), display_id)?;
        self.core.emit("conversation.updated", &updated, Some(actor));
        Ok(updated)
    }

    pub fn set_contact_attributes(&self, actor: &Actor, id: i64, changes: &Map<String, Value>) -> Result<Contact> {
        let contact = self.contact(actor, id)?.contact;
        let merged = self.merge_attributes("contact", &contact.custom_attributes, changes)?;
        self.core.repo.set_contact_attributes(id, &merged)?;
        let updated = self.contact(actor, id)?.contact;
        self.core.emit("contact.updated", &updated, Some(actor));
        Ok(updated)
    }
}
