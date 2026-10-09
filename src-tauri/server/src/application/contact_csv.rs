//! CSV export and import of contacts (administrators only).
use super::helpdesk::HelpdeskService;
use crate::domain::actor::Actor;
use crate::domain::contacts::{csv_line, normalize_phone, parse_csv, CSV_HEADER};
use crate::domain::error::{fail, Error, Result};
use crate::domain::helpdesk::require_admin;
use crate::domain::model::{ContactChanges, NewContact};
use serde::Serialize;

const MAX_ROWS: usize = 10_000;

#[derive(Debug, Serialize)]
pub struct ImportFailure {
    pub line: usize,
    pub error: String,
}

#[derive(Debug, Default, Serialize)]
pub struct ImportResult {
    pub created: usize,
    pub updated: usize,
    pub failed: Vec<ImportFailure>,
}

fn optional(value: Option<&String>) -> Option<String> {
    value.map(|v| v.trim().to_string()).filter(|v| !v.is_empty())
}

impl HelpdeskService {
    pub fn export_contacts(&self, actor: &Actor) -> Result<String> {
        require_admin(actor)?;
        let mut out = CSV_HEADER.join(",") + "\n";
        let mut after = 0;
        loop {
            let page = self.core.repo.contacts_after(after, 500)?;
            for contact in &page {
                out.push_str(&csv_line(contact));
                out.push('\n');
            }
            match page.last() {
                Some(last) if page.len() == 500 => after = last.id,
                _ => return Ok(out),
            }
        }
    }

    /// Creates or updates (by phone number) one contact per row; bad rows are reported, not fatal.
    pub fn import_contacts(&self, actor: &Actor, csv: &str) -> Result<ImportResult> {
        require_admin(actor)?;
        let rows = parse_csv(csv);
        let Some((header, rows)) = rows.split_first() else {
            return fail("O arquivo CSV está vazio");
        };
        let header: Vec<String> = header.iter().map(|h| h.trim().to_lowercase()).collect();
        if !header
            .iter()
            .any(|h| h == "name" || h == "phone_number" || h == "email")
        {
            return fail("Cabeçalho esperado: name, phone_number, email, identifier");
        }
        if rows.len() > MAX_ROWS {
            return fail(format!("Importe no máximo {MAX_ROWS} contatos por vez"));
        }
        let column =
            |row: &[String], name: &str| optional(header.iter().position(|h| h == name).and_then(|i| row.get(i)));
        let mut result = ImportResult::default();
        for (index, row) in rows.iter().enumerate() {
            if row.iter().all(|f| f.trim().is_empty()) {
                continue;
            }
            let parsed = column(row, "phone_number").map(|p| normalize_phone(&p)).transpose();
            let outcome = parsed.and_then(|phone| {
                let new = NewContact {
                    name: column(row, "name"),
                    phone_number: phone,
                    email: column(row, "email").filter(|e| e.contains('@') && e.len() <= 254),
                    identifier: column(row, "identifier"),
                };
                self.import_row(actor, &new)
            });
            match outcome {
                Ok(true) => result.created += 1,
                Ok(false) => result.updated += 1,
                Err(error) => result.failed.push(ImportFailure {
                    line: index + 2,
                    error: match error {
                        Error::Helpdesk(e) => e.message,
                        Error::Internal(_) => "Falha ao salvar".into(),
                    },
                }),
            }
        }
        Ok(result)
    }

    /// `true` when the row created a contact.
    fn import_row(&self, actor: &Actor, new: &NewContact) -> Result<bool> {
        if new.name.is_none() && new.phone_number.is_none() && new.email.is_none() {
            return fail("Linha sem nome, telefone ou e-mail");
        }
        let existing = match &new.phone_number {
            Some(phone) => self.core.repo.contact_by_phone(phone)?,
            None => None,
        };
        let Some(contact) = existing else {
            self.create_contact(actor, new)?;
            return Ok(true);
        };
        let changes = ContactChanges {
            name: new.name.clone().map(Some),
            email: new.email.clone().map(Some),
            identifier: new.identifier.clone().map(Some),
            ..Default::default()
        };
        self.update_contact(actor, contact.id, &changes)?;
        Ok(false)
    }
}
