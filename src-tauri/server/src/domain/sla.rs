//! SLA deadlines: first response, next response (while the contact waits) and resolution, counted
//! from when the policy was applied.
use super::model::{Conversation, SlaPolicy};
use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct SlaState {
    /// `active` while targets are pending, `hit` once resolved within all of them, `missed` otherwise.
    pub status: &'static str,
    pub first_response_due_at: Option<i64>,
    pub next_response_due_at: Option<i64>,
    pub resolution_due_at: Option<i64>,
    /// Targets already missed: `first_response`, `next_response`, `resolution`.
    pub missed: Vec<&'static str>,
}

/// Evaluates the conversation against the policy at `now` (`resolved_at`: when it was resolved).
pub fn evaluate(policy: &SlaPolicy, applied_at: i64, c: &Conversation, resolved_at: Option<i64>, now: i64) -> SlaState {
    let due = |threshold: Option<i64>, start: i64| threshold.map(|t| start + t);
    let first = due(policy.first_response_time_threshold, applied_at);
    let waiting = c
        .waiting_since
        .filter(|_| c.first_reply_at.is_some() && c.status != "resolved");
    let next = waiting.and_then(|w| due(policy.next_response_time_threshold, w.max(applied_at)));
    let resolution = due(policy.resolution_time_threshold, applied_at);
    let late = |deadline: Option<i64>, done: Option<i64>| match (deadline, done) {
        (Some(d), Some(at)) => at > d,
        (Some(d), None) => now > d,
        _ => false,
    };
    let mut missed = Vec::new();
    if late(first, c.first_reply_at) {
        missed.push("first_response");
    }
    if late(next, None) {
        missed.push("next_response");
    }
    if late(resolution, resolved_at) {
        missed.push("resolution");
    }
    let status = match (missed.is_empty(), resolved_at.is_some()) {
        (false, _) => "missed",
        (true, true) => "hit",
        (true, false) => "active",
    };
    SlaState {
        status,
        first_response_due_at: first.filter(|_| c.first_reply_at.is_none()),
        next_response_due_at: next,
        resolution_due_at: resolution.filter(|_| resolved_at.is_none()),
        missed,
    }
}
