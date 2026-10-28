//! Human approval of a tool call: approved runs the tool, rejected tells the agent; either way the
//! activity runs again (a fresh run that finds the decision through the idempotent call).
use super::EngineService;
use crate::domain::engine::activity::{self as status, call};
use crate::domain::engine::model::ToolCall;
use crate::domain::error::{fail, Result};
use serde_json::json;

impl EngineService {
    pub async fn decide(&self, account_id: i64, call_id: i64, approve: bool, user_id: i64) -> Result<ToolCall> {
        let Some(pending) = self.store.tool_call(account_id, call_id)? else {
            return fail("Chamada não encontrada");
        };
        let decision = if approve { call::OK } else { call::REJECTED };
        // The compare-and-set makes a second click (or a second person) a no-op.
        if !self.store.decide_tool_call(pending.id, decision, user_id)? {
            return fail("Esta chamada não aguarda aprovação");
        }
        let detail = json!({"ferramenta": pending.tool, "chamada": pending.id, "por": user_id});
        let outcome = if approve { "approved" } else { "rejected" };
        self.audit(
            account_id,
            Some(pending.activity_id),
            Some(pending.agent_id),
            "tool.approval",
            outcome,
            detail,
        );
        if approve {
            // A tool failure here is recorded on the call; the agent reads it in the next run.
            if self
                .run_business(account_id, pending.activity_id, pending.agent_id, &pending)
                .await
                .is_err()
            {
                self.store.update_tool_call(pending.id, call::FAILED, None, None)?;
            }
        }
        self.resume(account_id, pending.activity_id)?;
        self.store
            .tool_call(account_id, call_id)?
            .ok_or_else(|| crate::domain::error::Error::internal("tool call vanished"))
    }

    /// Puts an activity waiting for approval back to work.
    fn resume(&self, account_id: i64, activity_id: i64) -> Result<()> {
        if self
            .store
            .move_activity(activity_id, status::WAITING_APPROVAL, status::QUEUED, None)?
        {
            self.audit(
                account_id,
                Some(activity_id),
                None,
                "activity.resume",
                "queued",
                json!({}),
            );
            self.spawn_execute(account_id, activity_id);
        }
        Ok(())
    }

    /// A delegated activity finished: a parent that was waiting on it runs again.
    pub(super) fn resume_waiting_parent(&self, account_id: i64, parent_id: i64) {
        if let Err(error) = self.resume(account_id, parent_id) {
            tracing::warn!(%error, parent_id, "engine parent not resumed");
        }
    }
}
