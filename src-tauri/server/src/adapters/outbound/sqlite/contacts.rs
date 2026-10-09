//! Contacts, their WhatsApp channels, notes and labels.
use super::db::{flag, int, iso, now_ms, opt_int, opt_text, text, Shape, SqliteStore, PLAIN};
use super::inboxes::PAGE;
use crate::application::ports::ContactRepo;
use crate::domain::error::{Error, Result};
use crate::domain::model::{Contact, ContactChanges, ContactInbox};
use rusqlite::types::Value as Sql;

/// Contacts with their labels; custom attributes and labels are exposed as JSON.
pub(super) const CONTACT_SELECT: &str = "SELECT ct.*, (SELECT json_group_array(l.title) FROM (SELECT l.title
  FROM contact_labels x JOIN labels l ON l.id=x.label_id WHERE x.contact_id=ct.id ORDER BY l.title) l) AS labels
  FROM contacts ct";
pub(super) const CONTACT: Shape = Shape {
    json: &["custom_attributes", "labels"],
    bools: &[],
};

impl ContactRepo for SqliteStore {
    fn contact(&self, id: i64) -> Result<Option<Contact>> {
        self.row(&format!("{CONTACT_SELECT} WHERE ct.id=?"), vec![int(id)], CONTACT)
    }

    fn contact_inbox(&self, inbox_id: i64, source_id: &str) -> Result<Option<ContactInbox>> {
        let sql = "SELECT * FROM contact_inboxes WHERE inbox_id=? AND source_id=?";
        self.row(sql, vec![int(inbox_id), text(source_id)], PLAIN)
    }

    fn contact_by_phone(&self, phone: &str) -> Result<Option<Contact>> {
        self.row(
            &format!("{CONTACT_SELECT} WHERE ct.phone_number=?"),
            vec![text(phone)],
            CONTACT,
        )
    }

    fn create_contact(&self, name: Option<&str>, phone: Option<&str>) -> Result<Contact> {
        let id = self.insert(
            "INSERT INTO contacts(name,phone_number,created) VALUES(?,?,?)",
            vec![opt_text(name), opt_text(phone), text(iso(now_ms()))],
        )?;
        self.contact(id)?.ok_or_else(|| Error::internal("contact vanished"))
    }

    fn create_contact_inbox(&self, contact_id: i64, inbox_id: i64, source_id: &str) -> Result<ContactInbox> {
        let id = self.insert(
            "INSERT INTO contact_inboxes(contact_id,inbox_id,source_id) VALUES(?,?,?)",
            vec![int(contact_id), int(inbox_id), text(source_id)],
        )?;
        self.row("SELECT * FROM contact_inboxes WHERE id=?", vec![int(id)], PLAIN)?
            .ok_or_else(|| Error::internal("contact inbox vanished"))
    }

    fn contacts(&self, q: &str, page: i64) -> Result<Vec<Contact>> {
        let like = text(format!("%{q}%"));
        let sql = format!(
            "{CONTACT_SELECT} WHERE COALESCE(ct.name,'') LIKE ? OR COALESCE(ct.phone_number,'') LIKE ?
             OR COALESCE(ct.email,'') LIKE ? ORDER BY ct.last_activity_at DESC NULLS LAST, ct.id DESC LIMIT ? OFFSET ?"
        );
        let offset = (page.max(1) - 1) * PAGE;
        self.rows(
            &sql,
            vec![like.clone(), like.clone(), like, int(PAGE), int(offset)],
            CONTACT,
        )
    }

    fn update_contact(&self, id: i64, changes: &ContactChanges) -> Result<Contact> {
        let mut fields: Vec<(&str, Sql)> = Vec::new();
        for (key, value) in [
            ("name", &changes.name),
            ("email", &changes.email),
            ("identifier", &changes.identifier),
            ("phone_number", &changes.phone_number),
        ] {
            if let Some(value) = value {
                fields.push((key, opt_text(value.as_deref())));
            }
        }
        if let Some(blocked) = changes.blocked {
            fields.push(("blocked", flag(blocked)));
        }
        if let Some(at) = changes.last_activity_at {
            fields.push(("last_activity_at", opt_int(Some(at))));
        }
        self.update_fields("contacts", int(id), fields)?;
        self.contact(id)?.ok_or_else(|| Error::internal("contact vanished"))
    }
}
