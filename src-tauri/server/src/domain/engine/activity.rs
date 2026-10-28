//! States of an activity and the transitions the engine may make.
use crate::domain::error::{fail, Result};

pub const QUEUED: &str = "queued";
pub const RUNNING: &str = "running";
pub const WAITING_APPROVAL: &str = "waiting_approval";
pub const COMPLETED: &str = "completed";
pub const FAILED: &str = "failed";
pub const CANCELLED: &str = "cancelled";

pub const STATUSES: [&str; 6] = [QUEUED, RUNNING, WAITING_APPROVAL, COMPLETED, FAILED, CANCELLED];

/// Final states never change again.
pub fn is_final(status: &str) -> bool {
    matches!(status, COMPLETED | FAILED | CANCELLED)
}

pub fn can_transition(from: &str, to: &str) -> bool {
    match (from, to) {
        (from, CANCELLED) => !is_final(from),
        (QUEUED, RUNNING | FAILED) => true,
        (RUNNING, WAITING_APPROVAL | COMPLETED | FAILED) => true,
        // A retry after an interrupted or failed run puts the activity back in the queue.
        (RUNNING, QUEUED) => true,
        // Decided: back to the queue for a fresh run.
        (WAITING_APPROVAL, QUEUED | RUNNING | FAILED) => true,
        _ => false,
    }
}

pub fn transition(from: &str, to: &str) -> Result<()> {
    if can_transition(from, to) {
        Ok(())
    } else {
        fail(format!("Transição de atividade inválida: {from} → {to}"))
    }
}

/// Run states (`engine_runs.status`).
pub mod run {
    pub const RUNNING: &str = "running";
    pub const COMPLETED: &str = "completed";
    pub const FAILED: &str = "failed";
    pub const CANCELLED: &str = "cancelled";
    /// The process stopped (restart) while the run was going: the activity is retried.
    pub const INTERRUPTED: &str = "interrupted";
}

/// Tool call states (`engine_tool_calls.status`).
pub mod call {
    pub const OK: &str = "ok";
    pub const DENIED: &str = "denied";
    pub const FAILED: &str = "failed";
    pub const PENDING_APPROVAL: &str = "pending_approval";
    pub const REJECTED: &str = "rejected";
}

/// Delivery of the final answer to the requester's channel (`engine_activities.reply_state`).
pub mod reply {
    /// Being posted: if the process stops here, nobody knows whether it went out.
    pub const SENDING: &str = "sending";
    pub const SENT: &str = "sent";
}
