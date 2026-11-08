//! Live control of the engine: a paused agent's requests wait in the queue (and go on when it is
//! resumed), and an administrator can cancel a request with everything it delegated, stopping the
//! runs that are going.
use super::EngineService;
use crate::domain::engine::activity as status;
use crate::domain::engine::model::Activity;
use crate::domain::error::{fail_with, Result};
use serde_json::json;

impl EngineService {
    /// Leaves a paused agent's request in the queue.
    pub(super) fn hold(&self, activity: &Activity) -> Result<()> {
        if activity.status == status::RUNNING {
            self.store
                .move_activity(activity.id, status::RUNNING, status::QUEUED, None)?;
        }
        self.audit(
            activity.account_id,
            Some(activity.id),
            Some(activity.agent_id),
            "activity.hold",
            "paused",
            json!({}),
        );
        Ok(())
    }

    /// The agent was resumed: its queued requests run now.
    pub fn resume_agent(&self, agent_id: i64) -> Result<usize> {
        let waiting: Vec<Activity> = self
            .store
            .unfinished_roots()?
            .into_iter()
            .filter(|a| a.agent_id == agent_id && a.status == status::QUEUED)
            .collect();
        for activity in &waiting {
            self.spawn_execute(activity.account_id, activity.id);
        }
        Ok(waiting.len())
    }

    /// Cancels a request and what it delegated; the runs going are stopped on their runtime.
    pub async fn cancel(&self, account_id: i64, id: i64) -> Result<Activity> {
        let root = self.load(account_id, id)?;
        if status::is_final(&root.status) {
            return fail_with("Este pedido já terminou", 409);
        }
        let mut ids = vec![root.id];
        let delegations = self.store.delegations(account_id, &root.correlation_id)?;
        // Children first appear after their parent, so one pass collects the whole subtree.
        for delegation in &delegations {
            if ids.contains(&delegation.parent_activity_id) && !ids.contains(&delegation.activity_id) {
                ids.push(delegation.activity_id);
            }
        }
        for activity_id in ids {
            let Some(activity) = self.store.activity(account_id, activity_id)? else {
                continue;
            };
            if status::is_final(&activity.status) {
                continue;
            }
            self.store.move_activity(
                activity.id,
                &activity.status,
                status::CANCELLED,
                Some("Cancelado por uma pessoa"),
            )?;
            for run in self.store.runs(account_id, activity.id)? {
                let runtime = self.runtimes.get(&run.runtime);
                if let (Some(external), Some(runtime), true) = (
                    &run.external_id,
                    runtime,
                    run.status == crate::domain::engine::activity::run::RUNNING,
                ) {
                    if let Err(error) = runtime.cancel_run(external).await {
                        tracing::warn!(%error, run = run.id, "engine run not cancelled");
                    }
                }
            }
            self.audit(
                account_id,
                Some(activity.id),
                Some(activity.agent_id),
                "activity.cancel",
                "cancelled",
                json!({}),
            );
        }
        self.load(account_id, id)
    }
}
