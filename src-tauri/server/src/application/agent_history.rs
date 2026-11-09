//! The history on an AI agent's page (administrators): the conversations it answered, which of
//! them it handed to people and why, and its schedule runs.
use super::agents::AgentDirectory;
use crate::domain::actor::Actor;
use crate::domain::error::{fail, HelpdeskError, Result};
use crate::domain::helpdesk::require_admin;
use crate::domain::model::{parse_handoff, AgentHistory};
use crate::domain::salary::window_start;

/// The page lists at most this many conversations and schedule runs.
const LIMIT: i64 = 100;

impl AgentDirectory {
    /// What the AI agent did over the last `days` days (today included).
    pub fn history(&self, actor: &Actor, id: i64, days: i64) -> Result<AgentHistory> {
        require_admin(actor)?;
        let Some(agent) = self.core.repo.agent(id)? else {
            return Err(HelpdeskError::not_found("Agente não encontrado").into());
        };
        if agent.kind != "ai" {
            return fail("Só agentes de IA têm histórico de trabalho");
        }
        let days = days.clamp(1, 366);
        let since_iso = window_start(self.core.clock.now_ms(), days);
        let since_ms = chrono::DateTime::parse_from_rfc3339(&since_iso).map_or(0, |at| at.timestamp_millis());
        let repo = &self.core.repo;
        let mut conversations = repo.agent_conversations(id, &since_iso, since_ms / 1000, LIMIT)?;
        for conversation in &mut conversations {
            if let Some((to, reason)) = conversation.handoff_note.as_deref().and_then(parse_handoff) {
                conversation.handed_to = Some(to);
                conversation.handoff_reason = reason;
            }
        }
        Ok(AgentHistory {
            days,
            conversations,
            schedule_runs: repo.agent_schedule_runs(id, since_ms, LIMIT)?,
        })
    }
}
