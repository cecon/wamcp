//! `LiveRepo` over SQLite: paused agents, unanswered conversations and conversation summaries.
use super::db::{int, now_ms, text, SqliteStore};
use crate::application::ports::{ConversationSummary, LiveRepo};
use crate::domain::error::Result;
use rusqlite::OptionalExtension;

impl SqliteStore {
    pub(super) fn is_agent_paused(&self, agent_id: i64) -> Result<bool> {
        self.with(|db| {
            db.query_row("SELECT 1 FROM agent_pauses WHERE agent_id=?", [agent_id], |_| Ok(()))
                .optional()
        })
        .map(|row| row.is_some())
    }
}

impl LiveRepo for SqliteStore {
    fn paused_agents(&self) -> Result<Vec<i64>> {
        self.with(|db| {
            let mut statement = db.prepare("SELECT agent_id FROM agent_pauses ORDER BY agent_id")?;
            let rows = statement.query_map([], |row| row.get(0))?;
            rows.collect()
        })
    }

    fn set_agent_paused(&self, agent_id: i64, paused: bool) -> Result<()> {
        if paused {
            self.exec(
                "INSERT INTO agent_pauses(agent_id,paused_at) VALUES(?,?) ON CONFLICT(agent_id) DO NOTHING",
                vec![int(agent_id), int(now_ms())],
            )
        } else {
            self.exec("DELETE FROM agent_pauses WHERE agent_id=?", vec![int(agent_id)])
        }
        .map(drop)
    }

    fn unanswered_conversations(&self) -> Result<Vec<i64>> {
        self.with(|db| {
            let mut statement = db.prepare(
                "SELECT c.id FROM conversations c WHERE c.status='pending' AND (
                   SELECT m.message_type FROM conversation_messages m
                   WHERE m.conversation_id=c.id AND m.private=0 AND m.message_type<>'activity'
                   ORDER BY m.id DESC LIMIT 1)='incoming'
                 ORDER BY c.last_activity_at",
            )?;
            let rows = statement.query_map([], |row| row.get(0))?;
            rows.collect()
        })
    }

    fn conversation_summary(&self, conversation_id: i64) -> Result<Option<ConversationSummary>> {
        self.with(|db| {
            db.query_row(
                "SELECT summary,upto_message_id FROM conversation_summaries WHERE conversation_id=?",
                [conversation_id],
                |row| {
                    Ok(ConversationSummary {
                        conversation_id,
                        summary: row.get(0)?,
                        upto_message_id: row.get(1)?,
                    })
                },
            )
            .optional()
        })
    }

    fn save_conversation_summary(&self, summary: &ConversationSummary) -> Result<()> {
        self.exec(
            "INSERT INTO conversation_summaries(conversation_id,summary,upto_message_id,updated_at) VALUES(?,?,?,?)
             ON CONFLICT(conversation_id) DO UPDATE SET summary=excluded.summary,
               upto_message_id=excluded.upto_message_id,updated_at=excluded.updated_at",
            vec![
                int(summary.conversation_id),
                text(&summary.summary),
                int(summary.upto_message_id),
                int(now_ms()),
            ],
        )
        .map(drop)
    }
}
