//! Reporting (Chatwoot's ReportingEventListener + reports API): first response and resolution
//! times are recorded as events when they happen, then aggregated per period, inbox and agent.
use super::core::Core;
use super::event_bus::Envelope;
use super::ports::Period;
use crate::domain::actor::Actor;
use crate::domain::error::Result;
use crate::domain::model::{CsatEntry, ReportingEvent};
use crate::domain::roles::require_permission;
use serde_json::Value;

const DAY: i64 = 86_400;

#[derive(Clone)]
pub struct ReportService {
    pub core: Core,
}

/// Requested period: defaults to the last 7 days including the current second (`until` exclusive).
#[derive(Debug, Clone, Copy, Default)]
pub struct PeriodQuery {
    pub since: Option<i64>,
    pub until: Option<i64>,
    pub inbox_id: Option<i64>,
}

fn epoch_of(created: &str) -> i64 {
    chrono::DateTime::parse_from_rfc3339(created).map_or(0, |d| d.timestamp())
}

impl ReportService {
    pub fn on_event(&self, envelope: &Envelope) -> Result<()> {
        let (data, repo) = (&envelope.data, &self.core.repo);
        let int = |key: &str| data[key].as_i64();
        let sender = data["sender_type"].as_str().unwrap_or_default();
        let agent_reply = data["message_type"] == "outgoing"
            && !data["private"].as_bool().unwrap_or(false)
            && (sender == "user" || sender == "agent_bot");
        if envelope.event == "message.created" && agent_reply {
            let (Some(conversation), Some(created_at), Some(inbox)) =
                (int("conversation_id"), int("created_at"), int("inbox_id"))
            else {
                return Ok(());
            };
            let Some(first) = repo.first_incoming_at(conversation)? else {
                return Ok(());
            };
            if created_at < first {
                return Ok(());
            }
            repo.record_event(&ReportingEvent {
                name: "first_response",
                value: created_at - first,
                user_id: if sender == "user" { int("sender_id") } else { None },
                inbox_id: inbox,
                conversation_id: conversation,
                created_at,
            })?;
        } else if envelope.event == "conversation.status_changed" && data["status"] == "resolved" {
            let (Some(id), Some(inbox)) = (int("id"), int("inbox_id")) else {
                return Ok(());
            };
            let now = self.core.now();
            let start = match repo.first_incoming_at(id)? {
                Some(at) => at,
                None => epoch_of(data["created"].as_str().unwrap_or_default()),
            };
            repo.record_event(&ReportingEvent {
                name: "conversation_resolved",
                value: (now - start).max(0),
                user_id: int("assignee_id"),
                inbox_id: inbox,
                conversation_id: id,
                created_at: now,
            })?;
        }
        Ok(())
    }

    fn period(&self, query: PeriodQuery) -> Period {
        let until = query.until.unwrap_or(self.core.now() + 1);
        Period {
            since: query.since.unwrap_or(until - 7 * DAY),
            until,
            inbox_id: query.inbox_id,
        }
    }

    pub fn summary(&self, actor: &Actor, query: PeriodQuery) -> Result<Value> {
        require_permission(actor, "report_manage")?;
        self.core.repo.summary(&self.period(query))
    }

    pub fn agents(&self, actor: &Actor, query: PeriodQuery) -> Result<Vec<Value>> {
        require_permission(actor, "report_manage")?;
        self.core.repo.agent_report(&self.period(query))
    }

    pub fn csat(&self, actor: &Actor, query: PeriodQuery) -> Result<Vec<CsatEntry>> {
        require_permission(actor, "report_manage")?;
        self.core.repo.csat_responses(&self.period(query), 200)
    }
}
