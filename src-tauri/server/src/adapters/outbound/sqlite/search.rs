use super::contacts::{CONTACT, CONTACT_SELECT};
use super::conversations::{SELECT, SHAPE};
use super::db::{int, placeholders, text, SqliteStore, PLAIN};
use crate::application::ports::SearchRepo;
use crate::domain::error::Result;
use crate::domain::model::{Contact, Conversation};
use rusqlite::types::Value as Sql;
use serde_json::Value;

/// `%term%` with LIKE wildcards in the term escaped.
fn like(q: &str) -> Sql {
    let escaped = q.replace('!', "!!").replace('%', "!%").replace('_', "!_");
    text(format!("%{escaped}%"))
}

/// ` AND <column> IN (...)` for agents limited to some inboxes.
fn visible_clause(column: &str, visible: Option<&[i64]>, args: &mut Vec<Sql>) -> String {
    match visible {
        Some(ids) => {
            args.extend(ids.iter().map(|id| int(*id)));
            format!(" AND {column} IN ({})", placeholders(ids.len()))
        }
        None => String::new(),
    }
}

impl SearchRepo for SqliteStore {
    fn search_conversations(&self, q: &str, visible: Option<&[i64]>, limit: i64) -> Result<Vec<Conversation>> {
        let mut args = vec![
            like(q),
            like(q),
            like(q),
            int(q.trim_start_matches('#').parse().unwrap_or(-1)),
        ];
        let scope = visible_clause("c.inbox_id", visible, &mut args);
        args.push(int(limit));
        let sql = format!(
            "{SELECT} WHERE (ct.name LIKE ? ESCAPE '!' OR ct.phone_number LIKE ? ESCAPE '!'
             OR ct.email LIKE ? ESCAPE '!' OR c.display_id=?){scope} ORDER BY c.last_activity_at DESC LIMIT ?"
        );
        self.rows(&sql, args, SHAPE)
    }

    fn search_contacts(&self, q: &str, limit: i64) -> Result<Vec<Contact>> {
        let sql = format!(
            "{CONTACT_SELECT} WHERE ct.name LIKE ? ESCAPE '!' OR ct.phone_number LIKE ? ESCAPE '!'
             OR ct.email LIKE ? ESCAPE '!' OR ct.identifier LIKE ? ESCAPE '!'
             ORDER BY ct.last_activity_at DESC NULLS LAST LIMIT ?"
        );
        self.rows(&sql, vec![like(q), like(q), like(q), like(q), int(limit)], CONTACT)
    }

    fn search_messages(&self, q: &str, visible: Option<&[i64]>, limit: i64) -> Result<Vec<Value>> {
        let mut args = vec![like(q)];
        let scope = visible_clause("m.inbox_id", visible, &mut args);
        args.push(int(limit));
        let sql = format!(
            "SELECT m.id, m.content, m.message_type, m.created_at, m.conversation_id, c.display_id,
               ct.name AS contact_name FROM conversation_messages m JOIN conversations c ON c.id=m.conversation_id
             JOIN contacts ct ON ct.id=c.contact_id
             WHERE m.private=0 AND m.message_type IN ('incoming','outgoing') AND m.content LIKE ? ESCAPE '!'{scope}
             ORDER BY m.created_at DESC, m.id DESC LIMIT ?"
        );
        self.rows(&sql, args, PLAIN)
    }
}
