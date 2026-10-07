use super::db::{int, opt_int, text, SqliteStore, PLAIN};
use crate::application::ports::NotificationRepo;
use crate::domain::error::{Error, Result};
use crate::domain::model::Notification;
use serde_json::Value;

const NOTIFICATION: &str =
    "SELECT n.*, c.display_id, ct.name AS contact_name, u.name AS actor_name FROM notifications n
  LEFT JOIN conversations c ON c.id=n.conversation_id LEFT JOIN contacts ct ON ct.id=c.contact_id
  LEFT JOIN users u ON u.id=n.actor_user_id";
const AWAKE: &str = "(n.snoozed_until IS NULL OR n.snoozed_until<=?)";

impl NotificationRepo for SqliteStore {
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

    fn notifications(&self, user_id: i64, now: i64, limit: i64) -> Result<Vec<Notification>> {
        let sql = format!("{NOTIFICATION} WHERE n.user_id=? AND {AWAKE} ORDER BY n.id DESC LIMIT ?");
        self.rows(&sql, vec![int(user_id), int(now), int(limit)], PLAIN)
    }

    fn unread_notifications(&self, user_id: i64, now: i64) -> Result<i64> {
        let sql = format!("SELECT COUNT(*) FROM notifications n WHERE n.user_id=? AND n.read_at IS NULL AND {AWAKE}");
        Ok(self.scalar(&sql, vec![int(user_id), int(now)])?.unwrap_or(0))
    }

    fn read_notification(&self, user_id: i64, id: i64, at: i64) -> Result<usize> {
        let sql = "UPDATE notifications SET read_at=COALESCE(read_at,?) WHERE user_id=? AND id=?";
        self.exec(sql, vec![int(at), int(user_id), int(id)])
    }

    fn unread_notification(&self, user_id: i64, id: i64) -> Result<usize> {
        let sql = "UPDATE notifications SET read_at=NULL WHERE user_id=? AND id=?";
        self.exec(sql, vec![int(user_id), int(id)])
    }

    fn snooze_notification(&self, user_id: i64, id: i64, until: i64) -> Result<usize> {
        let sql = "UPDATE notifications SET snoozed_until=?, read_at=NULL WHERE user_id=? AND id=?";
        self.exec(sql, vec![int(until), int(user_id), int(id)])
    }

    fn delete_notification(&self, user_id: i64, id: i64) -> Result<usize> {
        let sql = "DELETE FROM notifications WHERE user_id=? AND id=?";
        self.exec(sql, vec![int(user_id), int(id)])
    }

    fn read_all_notifications(&self, user_id: i64, at: i64) -> Result<()> {
        let sql = "UPDATE notifications SET read_at=? WHERE user_id=? AND read_at IS NULL";
        self.exec(sql, vec![int(at), int(user_id)]).map(drop)
    }

    fn delete_all_notifications(&self, user_id: i64) -> Result<()> {
        self.exec("DELETE FROM notifications WHERE user_id=?", vec![int(user_id)])
            .map(drop)
    }

    fn notification_settings(&self, user_id: i64) -> Result<Value> {
        let flags: Option<String> = self.with(|c| {
            let mut statement = c.prepare_cached("SELECT flags FROM notification_settings WHERE user_id=?")?;
            let mut rows = statement.query([user_id])?;
            rows.next()?.map(|r| r.get(0)).transpose()
        })?;
        Ok(flags.map_or(Value::Object(Default::default()), |f| {
            serde_json::from_str(&f).unwrap_or_default()
        }))
    }

    fn set_notification_settings(&self, user_id: i64, flags: &Value) -> Result<()> {
        let sql = "INSERT INTO notification_settings(user_id,flags) VALUES(?,?)
                   ON CONFLICT(user_id) DO UPDATE SET flags=excluded.flags";
        self.exec(sql, vec![int(user_id), text(serde_json::to_string(flags)?)])
            .map(drop)
    }

    fn add_mention(&self, user_id: i64, conversation_id: i64, message_id: i64, at: i64) -> Result<bool> {
        let sql = "INSERT OR IGNORE INTO mentions(user_id,conversation_id,message_id,created_at) VALUES(?,?,?,?)";
        let inserted = self.exec(sql, vec![int(user_id), int(conversation_id), int(message_id), int(at)])?;
        Ok(inserted > 0)
    }
}
