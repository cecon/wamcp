//! The history of an AI agent's page: conversations it answered (its model calls in `llm_usage` and
//! its engine requests) and its schedule runs.
use super::db::{int, text, SqliteStore, PLAIN};
use crate::application::ports::AgentHistoryRepo;
use crate::domain::error::Result;
use crate::domain::model::{AgentConversation, AgentScheduleRun, HANDOFF_NOTE};

const CONVERSATIONS: &str = "WITH served AS (
    SELECT conversation_id AS id,COUNT(*) AS turns,MIN(at) AS first_at,MAX(at) AS last_at FROM llm_usage
      WHERE agent_id=?1 AND conversation_id IS NOT NULL AND at>=?2 GROUP BY conversation_id
    UNION ALL
    SELECT conversation_id,COUNT(*),MIN(created),MAX(updated) FROM engine_activities
      WHERE agent_id=?1 AND conversation_id IS NOT NULL AND parent_id IS NULL AND created>=?2 GROUP BY conversation_id),
  totals AS (SELECT id,SUM(turns) AS turns,MIN(first_at) AS first_at,MAX(last_at) AS last_at FROM served GROUP BY id),
  handoffs AS (SELECT m.conversation_id,m.content,m.created_at,
      ROW_NUMBER() OVER (PARTITION BY m.conversation_id ORDER BY m.created_at DESC,m.id DESC) AS n
    FROM conversation_messages m JOIN totals t ON t.id=m.conversation_id
    WHERE m.message_type='activity' AND m.created_at>=?3 AND substr(m.content,1,?4)=?5)
  SELECT c.id,c.display_id,c.inbox_id,i.name AS inbox_name,ct.name AS contact_name,c.status,
    t.turns,t.first_at,t.last_at,h.content AS handoff_note,h.created_at AS handoff_at
  FROM totals t JOIN conversations c ON c.id=t.id JOIN contacts ct ON ct.id=c.contact_id
    JOIN inboxes i ON i.id=c.inbox_id LEFT JOIN handoffs h ON h.conversation_id=c.id AND h.n=1
  ORDER BY t.last_at DESC LIMIT ?6";

impl AgentHistoryRepo for SqliteStore {
    fn agent_conversations(
        &self,
        agent_id: i64,
        since_iso: &str,
        since_secs: i64,
        limit: i64,
    ) -> Result<Vec<AgentConversation>> {
        let prefix = i64::try_from(HANDOFF_NOTE.chars().count()).unwrap_or(0);
        self.rows(
            CONVERSATIONS,
            vec![
                int(agent_id),
                text(since_iso),
                int(since_secs),
                int(prefix),
                text(HANDOFF_NOTE),
                int(limit),
            ],
            PLAIN,
        )
    }

    fn agent_schedule_runs(&self, agent_id: i64, since_ms: i64, limit: i64) -> Result<Vec<AgentScheduleRun>> {
        self.rows(
            "SELECT r.id,r.schedule_id,s.name AS schedule_name,r.status,r.output,r.error,r.started_at,r.finished_at
             FROM agent_schedule_runs r JOIN agent_schedules s ON s.id=r.schedule_id
             WHERE r.agent_id=? AND r.started_at>=? ORDER BY r.id DESC LIMIT ?",
            vec![int(agent_id), int(since_ms), int(limit)],
            PLAIN,
        )
    }
}
