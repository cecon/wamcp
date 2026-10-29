use super::db::{int, text, SqliteStore, PLAIN};
use crate::application::ports::AgentChatRepo;
use crate::domain::error::{Error, Result};
use crate::domain::model::{AgentChat, ChatMessage};

/// Messages with their chat's person and agent (the events and the UI need both).
const MESSAGE: &str = "SELECT m.id,m.chat_id,c.user_id,c.agent_id,m.role,m.content,m.created_at
  FROM agent_chat_messages m JOIN agent_chats c ON c.id=m.chat_id";

impl AgentChatRepo for SqliteStore {
    fn agent_chat(&self, user_id: i64, agent_id: i64) -> Result<AgentChat> {
        self.exec(
            "INSERT OR IGNORE INTO agent_chats(user_id,agent_id,created_at) VALUES(?,?,?)",
            vec![int(user_id), int(agent_id), int(super::db::now_ms())],
        )?;
        self.row(
            "SELECT * FROM agent_chats WHERE user_id=? AND agent_id=?",
            vec![int(user_id), int(agent_id)],
            PLAIN,
        )?
        .ok_or_else(|| Error::internal("chat vanished"))
    }

    fn agent_chat_by_id(&self, id: i64) -> Result<Option<AgentChat>> {
        self.row("SELECT * FROM agent_chats WHERE id=?", vec![int(id)], PLAIN)
    }

    fn chat_messages(&self, chat_id: i64, limit: i64) -> Result<Vec<ChatMessage>> {
        let sql = format!("SELECT * FROM ({MESSAGE} WHERE m.chat_id=? ORDER BY m.id DESC LIMIT ?) ORDER BY id");
        self.rows(&sql, vec![int(chat_id), int(limit)], PLAIN)
    }

    fn add_chat_message(&self, chat_id: i64, role: &str, content: &str, at: i64) -> Result<ChatMessage> {
        let id = self.insert(
            "INSERT INTO agent_chat_messages(chat_id,role,content,created_at) VALUES(?,?,?,?)",
            vec![int(chat_id), text(role), text(content), int(at)],
        )?;
        self.row(&format!("{MESSAGE} WHERE m.id=?"), vec![int(id)], PLAIN)?
            .ok_or_else(|| Error::internal("chat message vanished"))
    }

    fn last_chat_messages(&self, user_id: i64) -> Result<Vec<ChatMessage>> {
        let sql = format!(
            "{MESSAGE} WHERE c.user_id=? AND m.id=(SELECT MAX(id) FROM agent_chat_messages WHERE chat_id=c.id)"
        );
        self.rows(&sql, vec![int(user_id)], PLAIN)
    }
}
