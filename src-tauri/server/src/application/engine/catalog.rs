//! The tools of a run: the built-in ones and those of the installed plugins (through the
//! `BusinessTools` port), filtered by the agent's grants and by who asked for the run.
use super::EngineService;
use crate::application::ports::ToolInfo;
use crate::domain::engine::model::{Activity, EngineAgent};
use crate::domain::engine::tools::{builtins, ToolDef};

/// How far up a delegation chain the engine looks for the customer's message.
const MAX_DEPTH: usize = 16;

impl EngineService {
    /// Every tool of the organization: built-ins first, then the plugins'.
    pub(super) fn tools(&self, account_id: i64) -> Vec<ToolDef> {
        let mut all = builtins();
        all.extend(self.business.tools(account_id));
        all
    }

    pub(super) fn tool(&self, account_id: i64, name: &str) -> Option<ToolDef> {
        self.tools(account_id).into_iter().find(|tool| tool.name == name)
    }

    /// Built-in tools and the plugin tools the agent has a grant for; a run that answers a
    /// customer never sees the internal-only ones.
    pub(super) fn tools_for(&self, agent: &EngineAgent, from_customer: bool) -> Vec<ToolInfo> {
        let granted: Vec<String> = self
            .store
            .grants(agent.account_id, agent.id)
            .map(|grants| grants.into_iter().map(|g| g.tool).collect())
            .unwrap_or_default();
        self.tools(agent.account_id)
            .into_iter()
            .filter(|tool| tool.builtin || granted.iter().any(|g| g == &tool.name))
            .filter(|tool| !(from_customer && tool.internal_only))
            .map(|tool| ToolInfo {
                name: tool.name,
                description: tool.description,
                input_schema: tool.input_schema,
            })
            .collect()
    }

    /// The contact whose message started the activity (or the one it was delegated from).
    pub(super) fn customer_of(&self, activity: &Activity) -> Option<i64> {
        let mut current = Some(activity.clone());
        for _ in 0..MAX_DEPTH {
            let item = current?;
            if let Some(id) = item.requester.strip_prefix("contact:") {
                return id.parse().ok();
            }
            current = item
                .parent_id
                .and_then(|parent| self.store.activity(item.account_id, parent).ok().flatten());
        }
        None
    }

    /// Whether the activity (or one it was delegated from) came from a customer's message.
    pub(super) fn answers_customer(&self, activity: &Activity) -> bool {
        let mut current = Some(activity.clone());
        for _ in 0..MAX_DEPTH {
            let Some(item) = current else {
                return false;
            };
            if item.conversation_id.is_some() || item.requester.starts_with("contact:") {
                return true;
            }
            current = item
                .parent_id
                .and_then(|parent| self.store.activity(item.account_id, parent).ok().flatten());
        }
        // A chain this deep is treated as untrusted.
        true
    }
}
