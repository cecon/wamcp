use super::db::{flag, int, opt_int, opt_text, text, Shape, SqliteStore};
use crate::application::ports::AttachmentRepo;
use crate::domain::error::{Error, Result};
use crate::domain::model::{Attachment, AttachmentSource, NewAttachment};
use serde::Deserialize;

const ATTACHMENT: &str = "SELECT a.id,a.message_id,a.file_type,a.mime_type,a.file_name,a.file_size,a.duration,a.voice,
  a.path IS NOT NULL AS downloaded,'/api/v1/attachments/'||a.id AS data_url,a.path,w.session_id,m.inbox_id,m.wa_jid,
  m.source_id,m.created_at
  FROM attachments a JOIN conversation_messages m ON m.id=a.message_id JOIN inboxes i ON i.id=m.inbox_id
  JOIN channel_whatsapp w ON w.id=i.channel_id";
const SHAPE: Shape = Shape {
    json: &[],
    bools: &["voice", "downloaded"],
};

#[derive(Deserialize)]
struct Row {
    #[serde(flatten)]
    attachment: Attachment,
    path: Option<String>,
    session_id: String,
    inbox_id: i64,
    wa_jid: Option<String>,
    source_id: Option<String>,
    created_at: i64,
}

impl AttachmentRepo for SqliteStore {
    fn insert_attachment(&self, a: &NewAttachment) -> Result<Attachment> {
        let id = self.insert(
            "INSERT INTO attachments(message_id,file_type,mime_type,file_name,file_size,duration,voice,path,created_at)
             VALUES(?,?,?,?,?,?,?,?,strftime('%s','now'))",
            vec![
                int(a.message_id),
                text(a.file_type.as_str()),
                text(a.mime_type.as_str()),
                opt_text(a.file_name.as_deref()),
                opt_int(a.file_size),
                opt_int(a.duration),
                flag(a.voice),
                opt_text(a.path.as_deref()),
            ],
        )?;
        self.attachment_source(id)?
            .map(|s| s.attachment)
            .ok_or_else(|| Error::internal("attachment vanished"))
    }

    fn attachment_source(&self, id: i64) -> Result<Option<AttachmentSource>> {
        let row: Option<Row> = self.row(&format!("{ATTACHMENT} WHERE a.id=?"), vec![int(id)], SHAPE)?;
        Ok(row.map(|r| AttachmentSource {
            attachment: r.attachment,
            path: r.path,
            session_id: r.session_id,
            inbox_id: r.inbox_id,
            wa_jid: r.wa_jid,
            source_id: r.source_id,
            created_at: r.created_at,
        }))
    }

    fn set_attachment_file(&self, id: i64, path: &str, size: i64) -> Result<()> {
        let sql = "UPDATE attachments SET path=?,file_size=? WHERE id=?";
        self.exec(sql, vec![text(path), int(size), int(id)]).map(drop)
    }
}
