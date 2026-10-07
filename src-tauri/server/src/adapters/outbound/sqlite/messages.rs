use super::db::{flag, int, opt_int, opt_text, text, Shape, SqliteStore};
use crate::application::ports::MessageRepo;
use crate::domain::error::{Error, Result};
use crate::domain::model::{Message, NewMessage};
use rusqlite::types::Value as Sql;
use serde_json::Value;

/// Messages with their sender name and attachments (as JSON, with the authenticated download URL).
pub(super) const MESSAGE: &str = "SELECT m.*, CASE m.sender_type WHEN 'user' THEN u.name WHEN 'contact' THEN ct.name
    WHEN 'agent_bot' THEN 'Assistente IA' END AS sender_name,
  (SELECT json_group_array(json_object('id',a.id,'message_id',a.message_id,'file_type',a.file_type,
     'mime_type',a.mime_type,'file_name',a.file_name,'file_size',a.file_size,'duration',a.duration,
     'voice',json(CASE a.voice WHEN 1 THEN 'true' ELSE 'false' END),
     'downloaded',json(CASE WHEN a.path IS NULL THEN 'false' ELSE 'true' END),
     'data_url','/api/v1/attachments/'||a.id)) FROM attachments a WHERE a.message_id=m.id) AS attachments
  FROM conversation_messages m JOIN conversations c ON c.id=m.conversation_id JOIN contacts ct ON ct.id=c.contact_id
  LEFT JOIN users u ON m.sender_type='user' AND u.id=m.sender_id";
pub(super) const MESSAGE_SHAPE: Shape = Shape {
    json: &["content_attributes", "attachments"],
    bools: &["private"],
};

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

    fn set_message_content(&self, id: i64, content: Option<&str>) -> Result<()> {
        self.exec(
            "UPDATE conversation_messages SET content=? WHERE id=?",
            vec![opt_text(content), int(id)],
        )
        .map(drop)
    }
}
