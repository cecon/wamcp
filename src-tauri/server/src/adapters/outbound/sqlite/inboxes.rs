use super::db::{flag, int, iso, now_ms, opt_int, opt_text, placeholders, text, SqliteStore, PLAIN};
use crate::application::ports::{ContactRepo, InboxRepo};
use crate::domain::error::{Error, Result};
use crate::domain::model::{
    Contact, ContactChanges, ContactInbox, DaySchedule, Inbox, InboxChanges, WorkingHour,
};
use rusqlite::types::Value as Sql;

const INBOX: &str = "SELECT i.*, w.session_id, w.ignore_groups, s.status AS session_status, s.phone FROM inboxes i
  JOIN channel_whatsapp w ON w.id=i.channel_id JOIN sessions s ON s.id=w.session_id";
pub(crate) const PAGE: i64 = 25;

impl InboxRepo for SqliteStore {
    fn inbox(&self, id: i64) -> Result<Option<Inbox>> {
        self.row(&format!("{INBOX} WHERE i.id=?"), vec![int(id)], PLAIN)
    }

    fn inboxes(&self, ids: Option<&[i64]>) -> Result<Vec<Inbox>> {
        match ids {
            None => self.rows(&format!("{INBOX} ORDER BY i.name"), vec![], PLAIN),
            Some(ids) => {
                let sql = format!("{INBOX} WHERE i.id IN ({}) ORDER BY i.name", placeholders(ids.len()));
                self.rows(&sql, ids.iter().map(|id| int(*id)).collect(), PLAIN)
            }
        }
    }

    fn inbox_for_session(&self, session_id: &str) -> Result<Option<Inbox>> {
        let sql = "SELECT i.id FROM inboxes i JOIN channel_whatsapp w ON w.id=i.channel_id WHERE w.session_id=?";
        if let Some(id) = self.scalar(sql, vec![text(session_id)])? {
            return self.inbox(id);
        }
        let name: Option<String> = self.with(|c| {
            let mut statement = c.prepare_cached("SELECT name FROM sessions WHERE id=?")?;
            let mut rows = statement.query([session_id])?;
            rows.next()?.map(|r| r.get(0)).transpose()
        })?;
        let Some(name) = name else {
            return Ok(None);
        };
        let channel = self.insert("INSERT INTO channel_whatsapp(session_id) VALUES(?)", vec![text(session_id)])?;
        let id = self.insert(
            "INSERT INTO inboxes(name,channel_type,channel_id,created) VALUES(?,'whatsapp',?,?)",
            vec![text(name), int(channel), text(iso(now_ms()))],
        )?;
        self.inbox(id)
    }

    fn sync_inboxes(&self) -> Result<()> {
        let missing: Vec<String> = self.with(|c| {
            let sql = "SELECT id FROM sessions WHERE id NOT IN (SELECT session_id FROM channel_whatsapp)";
            let mut statement = c.prepare_cached(sql)?;
            let ids = statement.query_map([], |r| r.get(0))?;
            ids.collect()
        })?;
        for id in missing {
            self.inbox_for_session(&id)?;
        }
        Ok(())
    }

    fn update_inbox(&self, id: i64, changes: &InboxChanges) -> Result<Inbox> {
        let mut fields: Vec<(&str, Sql)> = Vec::new();
        let flags = [
            ("enable_auto_assignment", changes.enable_auto_assignment),
            ("greeting_enabled", changes.greeting_enabled),
            ("lock_to_single_conversation", changes.lock_to_single_conversation),
            ("agent_bot_enabled", changes.agent_bot_enabled),
            ("working_hours_enabled", changes.working_hours_enabled),
            ("csat_survey_enabled", changes.csat_survey_enabled),
        ];
        if let Some(name) = &changes.name {
            fields.push(("name", text(name.as_str())));
        }
        fields.extend(flags.into_iter().filter_map(|(k, v)| v.map(|v| (k, flag(v)))));
        if let Some(greeting) = &changes.greeting_message {
            fields.push(("greeting_message", opt_text(greeting.as_deref())));
        }
        if let Some(away) = &changes.out_of_office_message {
            fields.push(("out_of_office_message", opt_text(away.as_deref())));
        }
        if let Some(zone) = &changes.timezone {
            fields.push(("timezone", text(zone.as_str())));
        }
        self.update_fields("inboxes", int(id), fields)?;
        let current = self.inbox(id)?.ok_or_else(|| Error::internal("inbox vanished"))?;
        if let Some(ignore) = changes.ignore_groups {
            let sql = "UPDATE channel_whatsapp SET ignore_groups=? WHERE id=?";
            self.exec(sql, vec![flag(ignore), int(current.channel_id)])?;
            return self.inbox(id)?.ok_or_else(|| Error::internal("inbox vanished"));
        }
        Ok(current)
    }

    fn working_hours(&self, inbox_id: i64) -> Result<Vec<WorkingHour>> {
        self.rows("SELECT * FROM working_hours WHERE inbox_id=? ORDER BY day_of_week", vec![int(inbox_id)], PLAIN)
    }

    fn set_working_hours(&self, inbox_id: i64, days: &[DaySchedule]) -> Result<()> {
        self.exec("DELETE FROM working_hours WHERE inbox_id=?", vec![int(inbox_id)])?;
        for d in days {
            self.exec(
                "INSERT INTO working_hours(inbox_id,day_of_week,closed_all_day,open_minutes,close_minutes) VALUES(?,?,?,?,?)",
                vec![int(inbox_id), int(d.day_of_week), flag(d.closed_all_day), int(d.open_minutes), int(d.close_minutes)],
            )?;
        }
        Ok(())
    }
}

impl ContactRepo for SqliteStore {
    fn contact(&self, id: i64) -> Result<Option<Contact>> {
        self.row("SELECT * FROM contacts WHERE id=?", vec![int(id)], PLAIN)
    }

    fn contact_inbox(&self, inbox_id: i64, source_id: &str) -> Result<Option<ContactInbox>> {
        let sql = "SELECT * FROM contact_inboxes WHERE inbox_id=? AND source_id=?";
        self.row(sql, vec![int(inbox_id), text(source_id)], PLAIN)
    }

    fn contact_by_phone(&self, phone: &str) -> Result<Option<Contact>> {
        self.row("SELECT * FROM contacts WHERE phone_number=?", vec![text(phone)], PLAIN)
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
        let sql = "SELECT * FROM contacts WHERE COALESCE(name,'') LIKE ? OR COALESCE(phone_number,'') LIKE ?
                   OR COALESCE(email,'') LIKE ? ORDER BY last_activity_at DESC NULLS LAST, id DESC LIMIT ? OFFSET ?";
        let offset = (page.max(1) - 1) * PAGE;
        self.rows(sql, vec![like.clone(), like.clone(), like, int(PAGE), int(offset)], PLAIN)
    }

    fn update_contact(&self, id: i64, changes: &ContactChanges) -> Result<Contact> {
        let mut fields: Vec<(&str, Sql)> = Vec::new();
        for (key, value) in [("name", &changes.name), ("email", &changes.email), ("identifier", &changes.identifier)] {
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
