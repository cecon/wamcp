use super::contacts::{CONTACT, CONTACT_SELECT};
use super::db::{int, opt_int, opt_text, text, SqliteStore, PLAIN};
use crate::application::ports::ContactBookRepo;
use crate::domain::error::{Error, Result};
use crate::domain::model::{Contact, ContactChannel, ContactNote};

const NOTE: &str = "SELECT n.*, u.name AS user_name FROM contact_notes n LEFT JOIN users u ON u.id=n.user_id";

impl ContactBookRepo for SqliteStore {
    fn contact_notes(&self, contact_id: i64) -> Result<Vec<ContactNote>> {
        let sql = format!("{NOTE} WHERE n.contact_id=? ORDER BY n.created_at DESC, n.id DESC");
        self.rows(&sql, vec![int(contact_id)], PLAIN)
    }

    fn contact_note(&self, id: i64) -> Result<Option<ContactNote>> {
        self.row(&format!("{NOTE} WHERE n.id=?"), vec![int(id)], PLAIN)
    }

    fn create_contact_note(
        &self,
        contact_id: i64,
        user_id: Option<i64>,
        content: &str,
        at: i64,
    ) -> Result<ContactNote> {
        let id = self.insert(
            "INSERT INTO contact_notes(contact_id,user_id,content,created_at) VALUES(?,?,?,?)",
            vec![int(contact_id), opt_int(user_id), text(content), int(at)],
        )?;
        self.contact_note(id)?.ok_or_else(|| Error::internal("note vanished"))
    }

    fn delete_contact_note(&self, id: i64) -> Result<()> {
        self.exec("DELETE FROM contact_notes WHERE id=?", vec![int(id)])
            .map(drop)
    }

    fn set_contact_labels(&self, contact_id: i64, label_ids: &[i64]) -> Result<()> {
        self.exec("DELETE FROM contact_labels WHERE contact_id=?", vec![int(contact_id)])?;
        for id in label_ids {
            let sql = "INSERT OR IGNORE INTO contact_labels(contact_id,label_id) VALUES(?,?)";
            self.exec(sql, vec![int(contact_id), int(*id)])?;
        }
        Ok(())
    }

    fn set_contact_avatar(&self, contact_id: i64, url: Option<&str>) -> Result<()> {
        let sql = "UPDATE contacts SET avatar_url=? WHERE id=?";
        self.exec(sql, vec![opt_text(url), int(contact_id)]).map(drop)
    }

    fn contact_channels(&self, contact_id: i64) -> Result<Vec<ContactChannel>> {
        let sql = "SELECT ci.inbox_id, w.session_id, ci.source_id FROM contact_inboxes ci
                   JOIN inboxes i ON i.id=ci.inbox_id JOIN channel_whatsapp w ON w.id=i.channel_id
                   WHERE ci.contact_id=? ORDER BY ci.id";
        self.rows(sql, vec![int(contact_id)], PLAIN)
    }

    fn delete_contact(&self, id: i64) -> Result<()> {
        self.exec("DELETE FROM contacts WHERE id=?", vec![int(id)]).map(drop)
    }

    fn merge_contacts(&self, base: i64, mergee: i64) -> Result<()> {
        let moves = [
            "UPDATE contact_inboxes SET contact_id=? WHERE contact_id=?",
            "UPDATE conversations SET contact_id=? WHERE contact_id=?",
            "UPDATE contact_notes SET contact_id=? WHERE contact_id=?",
            "UPDATE csat_responses SET contact_id=? WHERE contact_id=?",
            "UPDATE conversation_messages SET sender_id=? WHERE sender_type='contact' AND sender_id=?",
            "INSERT OR IGNORE INTO contact_labels(contact_id,label_id) SELECT ?,label_id FROM contact_labels WHERE contact_id=?",
        ];
        for sql in moves {
            self.exec(sql, vec![int(base), int(mergee)])?;
        }
        self.delete_contact(mergee)
    }

    fn contacts_after(&self, after_id: i64, limit: i64) -> Result<Vec<Contact>> {
        let sql = format!("{CONTACT_SELECT} WHERE ct.id>? ORDER BY ct.id LIMIT ?");
        self.rows(&sql, vec![int(after_id), int(limit)], CONTACT)
    }
}
