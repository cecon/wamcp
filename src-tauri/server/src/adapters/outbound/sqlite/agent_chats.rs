use super::db::{int, text, SqliteStore, PLAIN};
use crate::application::ports::AgentChatRepo;
use crate::domain::error::{Error, Result};
use crate::domain::model::{AgentChat, ChatMessage, ChatSession};

/// Messages with their chat's person and agent (the events and the UI need both).
const MESSAGE: &str = "SELECT m.id,m.chat_id,c.user_id,c.agent_id,m.role,m.content,m.created_at,m.session
  FROM agent_chat_messages m JOIN agent_chats c ON c.id=m.chat_id";

/// The sessions of a chat with what each spent; the open one is listed even before its first message.
const SESSIONS: &str = "WITH s AS (
    SELECT session,MIN(created_at) started_at,MAX(created_at) last_at,COUNT(*) messages,
      (SELECT content FROM agent_chat_messages f WHERE f.chat_id=?1 AND f.session=m.session AND f.role='user'
        ORDER BY f.id LIMIT 1) preview
    FROM agent_chat_messages m WHERE chat_id=?1 GROUP BY session
    UNION ALL
    SELECT c.session,c.created_at,c.created_at,0,NULL FROM agent_chats c
    WHERE c.id=?1 AND NOT EXISTS (SELECT 1 FROM agent_chat_messages WHERE chat_id=?1 AND session=c.session))
  SELECT s.session number,s.started_at,s.last_at,s.messages,s.preview,
    COALESCE(SUM(u.input_tokens+u.cached_tokens+u.output_tokens),0) tokens,COALESCE(SUM(u.cost),0.0) cost_usd
  FROM s LEFT JOIN llm_usage u ON u.run_ref='agent_chat:'||?1||':'||s.session
  GROUP BY s.session ORDER BY s.session DESC";

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
        let sql = format!(
            "SELECT * FROM ({MESSAGE} WHERE m.chat_id=? AND m.session=c.session ORDER BY m.id DESC LIMIT ?) ORDER BY id"
        );
        self.rows(&sql, vec![int(chat_id), int(limit)], PLAIN)
    }

    fn session_messages(&self, chat_id: i64, session: i64, limit: i64) -> Result<Vec<ChatMessage>> {
        let sql = format!(
            "SELECT * FROM ({MESSAGE} WHERE m.chat_id=? AND m.session=? ORDER BY m.id DESC LIMIT ?) ORDER BY id"
        );
        self.rows(&sql, vec![int(chat_id), int(session), int(limit)], PLAIN)
    }

    fn add_chat_message(&self, chat_id: i64, role: &str, content: &str, at: i64) -> Result<ChatMessage> {
        let id = self.insert(
            "INSERT INTO agent_chat_messages(chat_id,role,content,created_at,session)
             SELECT ?1,?2,?3,?4,session FROM agent_chats WHERE id=?1",
            vec![int(chat_id), text(role), text(content), int(at)],
        )?;
        self.row(&format!("{MESSAGE} WHERE m.id=?"), vec![int(id)], PLAIN)?
            .ok_or_else(|| Error::internal("chat message vanished"))
    }

    fn last_chat_messages(&self, user_id: i64) -> Result<Vec<ChatMessage>> {
        let sql = format!(
            "{MESSAGE} WHERE c.user_id=? AND m.id=(SELECT MAX(id) FROM agent_chat_messages
               WHERE chat_id=c.id AND session=c.session)"
        );
        self.rows(&sql, vec![int(user_id)], PLAIN)
    }

    fn new_chat_session(&self, chat_id: i64) -> Result<AgentChat> {
        self.exec(
            "UPDATE agent_chats SET session=session+1 WHERE id=?1
               AND EXISTS (SELECT 1 FROM agent_chat_messages m WHERE m.chat_id=?1 AND m.session=agent_chats.session)",
            vec![int(chat_id)],
        )?;
        self.agent_chat_by_id(chat_id)?
            .ok_or_else(|| Error::internal("chat vanished"))
    }

    fn chat_sessions(&self, chat_id: i64) -> Result<Vec<ChatSession>> {
        self.rows(SESSIONS, vec![int(chat_id)], PLAIN)
    }
}
