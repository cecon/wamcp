//! Contact book: creating, deleting and merging contacts, notes and labels.
use super::core::Events;
use super::helpdesk::HelpdeskService;
use crate::domain::actor::Actor;
use crate::domain::error::{fail, fail_with, HelpdeskError, Result};
use crate::domain::helpdesk::require_admin;
use crate::domain::model::{Contact, ContactChanges, ContactNote, NewContact};
use crate::domain::roles::require_permission;
use serde_json::{json, Value};

impl HelpdeskService {
    pub(super) fn find_contact(&self, id: i64) -> Result<Contact> {
        self.core
            .repo
            .contact(id)?
            .ok_or_else(|| HelpdeskError::not_found("Contato não encontrado").into())
    }

    /// A phone number may belong to one contact only.
    pub(super) fn ensure_free_phone(&self, phone: Option<&str>, except_id: i64) -> Result<()> {
        match phone.map(|p| self.core.repo.contact_by_phone(p)).transpose()?.flatten() {
            Some(other) if other.id != except_id => fail_with("Já existe um contato com este telefone", 422),
            _ => Ok(()),
        }
    }

    /// Inserts a contact inside a running unit of work (shared by creation and CSV import).
    pub(super) fn insert_contact(&self, new: &NewContact, events: &mut Events) -> Result<Contact> {
        self.ensure_free_phone(new.phone_number.as_deref(), 0)?;
        let repo = &self.core.repo;
        let created = repo.create_contact(new.name.as_deref(), new.phone_number.as_deref())?;
        let extra = ContactChanges {
            email: new.email.clone().map(Some),
            identifier: new.identifier.clone().map(Some),
            ..Default::default()
        };
        let contact = repo.update_contact(created.id, &extra)?;
        events.push("contact.created", &contact);
        Ok(contact)
    }

    pub fn create_contact(&self, actor: &Actor, new: &NewContact) -> Result<Contact> {
        require_permission(actor, "contact_manage")?;
        if new.name.is_none() && new.phone_number.is_none() && new.email.is_none() {
            return fail("Informe ao menos nome, telefone ou e-mail");
        }
        self.core.commit(Some(actor), |events| self.insert_contact(new, events))
    }

    /// Administrators may delete a contact with its conversations.
    pub fn delete_contact(&self, actor: &Actor, id: i64) -> Result<()> {
        require_admin(actor)?;
        self.find_contact(id)?;
        self.core.repo.delete_contact(id)?;
        self.core.emit("contact.deleted", &json!({ "id": id }), Some(actor));
        Ok(())
    }

    pub fn contact_notes(&self, actor: &Actor, id: i64) -> Result<Vec<ContactNote>> {
        require_permission(actor, "contact_manage")?;
        self.find_contact(id)?;
        self.core.repo.contact_notes(id)
    }

    pub fn add_contact_note(&self, actor: &Actor, id: i64, content: &str) -> Result<ContactNote> {
        require_permission(actor, "contact_manage")?;
        self.find_contact(id)?;
        let at = self.core.now();
        self.core
            .repo
            .create_contact_note(id, actor.user_id(), content.trim(), at)
    }

    /// Notes are removed by their author or an administrator.
    pub fn delete_contact_note(&self, actor: &Actor, id: i64, note_id: i64) -> Result<()> {
        require_permission(actor, "contact_manage")?;
        let note = match self.core.repo.contact_note(note_id)? {
            Some(note) if note.contact_id == id => note,
            _ => return Err(HelpdeskError::not_found("Nota não encontrada").into()),
        };
        if !actor.is_admin() && note.user_id != actor.user_id() {
            return fail_with("Somente o autor pode apagar esta nota", 403);
        }
        self.core.repo.delete_contact_note(note_id)
    }

    pub fn set_contact_labels(&self, actor: &Actor, id: i64, titles: &[String]) -> Result<Contact> {
        require_permission(actor, "contact_manage")?;
        self.find_contact(id)?;
        let labels = self.resolve_labels(titles)?;
        let ids: Vec<i64> = labels.iter().map(|l| l.id).collect();
        self.core.repo.set_contact_labels(id, &ids)?;
        let updated = self.find_contact(id)?;
        self.core.emit("contact.updated", &updated, Some(actor));
        Ok(updated)
    }

    /// Merges `mergee` into `base` (Chatwoot `contact_merge`): base fields win, gaps are filled from
    /// the mergee, and its channels, conversations, labels and notes move to the base.
    pub fn merge_contacts(&self, actor: &Actor, base_id: i64, mergee_id: i64) -> Result<Contact> {
        require_permission(actor, "contact_manage")?;
        if base_id == mergee_id {
            return fail("Escolha dois contatos diferentes");
        }
        let (base, mergee) = (self.find_contact(base_id)?, self.find_contact(mergee_id)?);
        let fill = |current: &Option<String>, other: &Option<String>| match (current, other) {
            (None, Some(value)) => Some(Some(value.clone())),
            _ => None,
        };
        let changes = ContactChanges {
            name: fill(&base.name, &mergee.name),
            email: fill(&base.email, &mergee.email),
            identifier: fill(&base.identifier, &mergee.identifier),
            phone_number: fill(&base.phone_number, &mergee.phone_number),
            blocked: (mergee.blocked != 0 && base.blocked == 0).then_some(true),
            ..Default::default()
        };
        let mut attributes = mergee.custom_attributes.as_object().cloned().unwrap_or_default();
        attributes.extend(base.custom_attributes.as_object().cloned().unwrap_or_default());
        self.core.commit(Some(actor), |events| {
            let repo = &self.core.repo;
            repo.merge_contacts(base_id, mergee_id)?;
            repo.update_contact(base_id, &changes)?;
            repo.set_contact_attributes(base_id, &Value::Object(attributes))?;
            let merged = self.find_contact(base_id)?;
            events.push("contact.deleted", &json!({ "id": mergee_id }));
            events.push("contact.updated", &merged);
            Ok(merged)
        })
    }
}
