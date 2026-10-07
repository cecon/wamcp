use super::db::{flag, int, opt_int, opt_text, placeholders, text, Shape, SqliteStore, PLAIN};
use crate::application::ports::{CatalogRepo, MessageRepo};
use crate::domain::error::{Error, Result};
use crate::domain::model::{CannedResponse, Label, LabelFields, Message, NewMessage, Notification};
use rusqlite::types::Value as Sql;
use serde_json::Value;

const MESSAGE: &str = "SELECT m.*, CASE m.sender_type WHEN 'user' THEN u.name WHEN 'contact' THEN ct.name
    WHEN 'agent_bot' THEN 'Assistente IA' END AS sender_name
  FROM conversation_messages m JOIN conversations c ON c.id=m.conversation_id JOIN contacts ct ON ct.id=c.contact_id
  LEFT JOIN users u ON m.sender_type='user' AND u.id=m.sender_id";
const MESSAGE_SHAPE: Shape = Shape {
    json: &["content_attributes"],
    bools: &["private"],
};
const NOTIFICATION: &str =
    "SELECT n.*, c.display_id, ct.name AS contact_name, u.name AS actor_name FROM notifications n
  LEFT JOIN conversations c ON c.id=n.conversation_id LEFT JOIN contacts ct ON ct.id=c.contact_id
  LEFT JOIN users u ON u.id=n.actor_user_id";

impl MessageRepo for SqliteStore {
    fn message(&self, id: i64) -> Result<Option<Message>> {
        self.row(&format!("{MESSAGE} WHERE m.id=?"), vec![int(id)], MESSAGE_SHAPE)
    }

    fn insert_message(&self, m: &NewMessage) -> Result<Option<Message>> {
        let attributes = if m.content_attributes.is_null() {
            "{}".to_string()
        } else {
            m.content_attributes.to_string()
        };
        let params = vec![
            int(m.conversation_id),
            int(m.inbox_id),
            text(m.message_type.as_str()),
            opt_text(m.content.as_deref()),
            text(m.content_type.as_deref().unwrap_or("text")),
            flag(m.private),
            text(m.status.as_deref().unwrap_or("sent")),
            opt_text(m.sender_type.as_deref()),
            opt_int(m.sender_id),
            opt_text(m.source_id.as_deref()),
            opt_text(m.wa_jid.as_deref()),
            text(attributes),
            int(m.created_at),
        ];
        let sql = "INSERT INTO conversation_messages(conversation_id,inbox_id,message_type,content,content_type,private,status,
             sender_type,sender_id,source_id,wa_jid,content_attributes,created_at)
           VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(inbox_id,source_id) WHERE source_id IS NOT NULL DO NOTHING";
        let inserted = self.with(|c| {
            let changes = c.execute(sql, rusqlite::params_from_iter(params))?;
            Ok((changes > 0).then(|| c.last_insert_rowid()))
        })?;
        match inserted {
            Some(id) => self.message(id),
            None => Ok(None),
        }
    }

    fn message_by_source(&self, inbox_id: i64, source_id: &str) -> Result<Option<Message>> {
        let sql = format!("{MESSAGE} WHERE m.inbox_id=? AND m.source_id=?");
        self.row(&sql, vec![int(inbox_id), text(source_id)], MESSAGE_SHAPE)
    }

    fn update_message(&self, id: i64, status: Option<&str>, attributes: Option<&Value>) -> Result<Message> {
        let mut fields: Vec<(&str, Sql)> = Vec::new();
        if let Some(status) = status {
            fields.push(("status", text(status)));
        }
        if let Some(attributes) = attributes {
            fields.push(("content_attributes", text(attributes.to_string())));
        }
        self.update_fields("conversation_messages", int(id), fields)?;
        self.message(id)?.ok_or_else(|| Error::internal("message vanished"))
    }

    fn messages(&self, conversation_id: i64, before: Option<i64>, limit: i64) -> Result<Vec<Message>> {
        let sql = format!("{MESSAGE} WHERE m.conversation_id=? AND m.id<? ORDER BY m.id DESC LIMIT ?");
        let params = vec![int(conversation_id), int(before.unwrap_or(i64::MAX)), int(limit)];
        let mut page: Vec<Message> = self.rows(&sql, params, MESSAGE_SHAPE)?;
        page.reverse();
        Ok(page)
    }
}

impl CatalogRepo for SqliteStore {
    fn labels(&self) -> Result<Vec<Label>> {
        self.rows("SELECT * FROM labels ORDER BY title", vec![], PLAIN)
    }

    fn label(&self, id: i64) -> Result<Option<Label>> {
        self.row("SELECT * FROM labels WHERE id=?", vec![int(id)], PLAIN)
    }

    fn label_by_title(&self, title: &str, except_id: i64) -> Result<Option<Label>> {
        self.row(
            "SELECT * FROM labels WHERE title=? AND id<>?",
            vec![text(title), int(except_id)],
            PLAIN,
        )
    }

    fn labels_by_titles(&self, titles: &[String]) -> Result<Vec<Label>> {
        let sql = format!("SELECT * FROM labels WHERE title IN ({})", placeholders(titles.len()));
        self.rows(&sql, titles.iter().map(|t| text(t.as_str())).collect(), PLAIN)
    }

    fn create_label(&self, title: &str, fields: &LabelFields) -> Result<Label> {
        let id = self.insert(
            "INSERT INTO labels(title,description,color,show_on_sidebar) VALUES(?,?,?,?)",
            vec![
                text(title),
                opt_text(fields.description.clone().flatten().as_deref()),
                text(
                    fields
                        .color
                        .clone()
                        .filter(|c| !c.is_empty())
                        .unwrap_or_else(|| "#1f93ff".into()),
                ),
                flag(fields.show_on_sidebar.unwrap_or(true)),
            ],
        )?;
        self.label(id)?.ok_or_else(|| Error::internal("label vanished"))
    }

    fn update_label(&self, id: i64, title: Option<&str>, fields: &LabelFields) -> Result<Label> {
        let mut changes: Vec<(&str, Sql)> = Vec::new();
        if let Some(title) = title {
            changes.push(("title", text(title)));
        }
        if let Some(description) = &fields.description {
            changes.push(("description", opt_text(description.as_deref())));
        }
        if let Some(color) = &fields.color {
            changes.push(("color", text(color.as_str())));
        }
        if let Some(show) = fields.show_on_sidebar {
            changes.push(("show_on_sidebar", flag(show)));
        }
        self.update_fields("labels", int(id), changes)?;
        self.label(id)?.ok_or_else(|| Error::internal("label vanished"))
    }

    fn delete_label(&self, id: i64) -> Result<()> {
        self.exec("DELETE FROM labels WHERE id=?", vec![int(id)]).map(drop)
    }

    fn canned_responses(&self, q: &str) -> Result<Vec<CannedResponse>> {
        let like = text(format!("%{q}%"));
        let sql =
            "SELECT * FROM canned_responses WHERE short_code LIKE ? OR content LIKE ? ORDER BY short_code LIMIT 200";
        self.rows(sql, vec![like.clone(), like], PLAIN)
    }

    fn canned_response(&self, id: i64) -> Result<Option<CannedResponse>> {
        self.row("SELECT * FROM canned_responses WHERE id=?", vec![int(id)], PLAIN)
    }

    fn canned_by_code(&self, code: &str, except_id: i64) -> Result<Option<CannedResponse>> {
        let sql = "SELECT * FROM canned_responses WHERE short_code=? AND id<>?";
        self.row(sql, vec![text(code), int(except_id)], PLAIN)
    }

    fn create_canned(&self, code: &str, content: &str) -> Result<CannedResponse> {
        let id = self.insert(
            "INSERT INTO canned_responses(short_code,content) VALUES(?,?)",
            vec![text(code), text(content)],
        )?;
        self.canned_response(id)?
            .ok_or_else(|| Error::internal("canned vanished"))
    }

    fn update_canned(&self, id: i64, code: Option<&str>, content: Option<&str>) -> Result<CannedResponse> {
        let mut changes: Vec<(&str, Sql)> = Vec::new();
        if let Some(code) = code {
            changes.push(("short_code", text(code)));
        }
        if let Some(content) = content {
            changes.push(("content", text(content)));
        }
        self.update_fields("canned_responses", int(id), changes)?;
        self.canned_response(id)?
            .ok_or_else(|| Error::internal("canned vanished"))
    }

    fn delete_canned(&self, id: i64) -> Result<()> {
        self.exec("DELETE FROM canned_responses WHERE id=?", vec![int(id)])
            .map(drop)
    }

    fn create_notification(
        &self,
        user_id: i64,
        kind: &str,
        conversation_id: i64,
        actor: Option<i64>,
        at: i64,
    ) -> Result<Notification> {
        let id = self.insert(
            "INSERT INTO notifications(user_id,notification_type,conversation_id,actor_user_id,created_at) VALUES(?,?,?,?,?)",
            vec![int(user_id), text(kind), int(conversation_id), opt_int(actor), int(at)],
        )?;
        self.row(&format!("{NOTIFICATION} WHERE n.id=?"), vec![int(id)], PLAIN)?
            .ok_or_else(|| Error::internal("notification vanished"))
    }

    fn notifications(&self, user_id: i64, limit: i64) -> Result<Vec<Notification>> {
        let sql = format!("{NOTIFICATION} WHERE n.user_id=? ORDER BY n.id DESC LIMIT ?");
        self.rows(&sql, vec![int(user_id), int(limit)], PLAIN)
    }

    fn unread_notifications(&self, user_id: i64) -> Result<i64> {
        let sql = "SELECT COUNT(*) FROM notifications WHERE user_id=? AND read_at IS NULL";
        Ok(self.scalar(sql, vec![int(user_id)])?.unwrap_or(0))
    }

    fn read_notification(&self, user_id: i64, id: i64, at: i64) -> Result<usize> {
        let sql = "UPDATE notifications SET read_at=COALESCE(read_at,?) WHERE user_id=? AND id=?";
        self.exec(sql, vec![int(at), int(user_id), int(id)])
    }

    fn read_all_notifications(&self, user_id: i64, at: i64) -> Result<()> {
        let sql = "UPDATE notifications SET read_at=? WHERE user_id=? AND read_at IS NULL";
        self.exec(sql, vec![int(at), int(user_id)]).map(drop)
    }
}
