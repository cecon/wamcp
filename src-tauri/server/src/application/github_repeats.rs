//! A workflow that keeps failing on a branch (no PR): the agent hears about it once. The next
//! failures stay in the conversation as activity until a run of that workflow passes again.
use super::helpdesk::HelpdeskService;
use crate::domain::github::FAILED;
use crate::domain::model::GithubChannel;
use serde_json::Value;

impl HelpdeskService {
    /// True when this `workflow_run` repeats a failure already reported; a passing run clears it.
    /// Kept in memory: after a restart the next failure is reported once more.
    pub(crate) fn repeated_github_failure(&self, channel: &GithubChannel, event: &str, payload: &Value) -> bool {
        let run = &payload["workflow_run"];
        let on_branch = run["pull_requests"].as_array().is_none_or(|prs| prs.is_empty());
        if event != "workflow_run" || payload["action"] != "completed" || !on_branch {
            return false;
        }
        let key = format!(
            "{}|{}|{}",
            channel.inbox_id,
            run["name"].as_str().unwrap_or_default(),
            run["head_branch"].as_str().unwrap_or_default()
        );
        let mut state = self.github_runs.lock();
        match run["conclusion"].as_str() {
            Some(conclusion) if FAILED.contains(&conclusion) => !state.failing.insert(key),
            Some("success") => {
                state.failing.remove(&key);
                false
            }
            _ => false,
        }
    }
}
