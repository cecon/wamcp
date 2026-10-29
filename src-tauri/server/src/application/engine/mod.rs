//! The agentic engine's use cases: activities submitted to AI agents, runs driven through the
//! `AgentRuntime` port, tools served through the `ToolGateway` (delegation, conclusion, memory and
//! granted business tools), approvals and startup recovery. See `docs/engine/spec.md`.
mod approvals;
mod channel;
mod conclude;
mod delegate;
mod drive;
mod gateway;
mod memory;
mod report;
mod submit;

pub use channel::HelpdeskChannel;
pub use submit::Submission;

use super::ports::{AgentRuntime, BusinessTools, EngineRepo, ReplyChannel};
use crate::domain::engine::model::EngineAgent;
use crate::domain::error::{fail, Result};
use parking_lot::Mutex;
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use tokio::sync::Semaphore;

/// Resolves the model API key of an agent (from its encrypted credentials), if it has one.
pub type KeyResolver = Arc<dyn Fn(&EngineAgent) -> Option<String> + Send + Sync>;

#[derive(Clone)]
pub struct EngineService {
    pub store: Arc<dyn EngineRepo>,
    runtimes: Arc<HashMap<String, Arc<dyn AgentRuntime>>>,
    /// Runtime used when the agent's own runtime is not an engine runtime.
    default_runtime: String,
    business: Arc<dyn BusinessTools>,
    channel: Arc<dyn ReplyChannel>,
    keys: KeyResolver,
    /// Where runtimes reach the engine's MCP endpoint (`None`: in-process runtimes only).
    mcp_url: Option<String>,
    slots: Arc<Mutex<HashMap<i64, Arc<Semaphore>>>>,
    /// Activities being executed in this process (one driver per activity).
    active: Arc<Mutex<HashSet<i64>>>,
}

pub struct EngineDeps {
    pub store: Arc<dyn EngineRepo>,
    pub runtimes: Vec<(String, Arc<dyn AgentRuntime>)>,
    pub default_runtime: String,
    pub business: Arc<dyn BusinessTools>,
    pub channel: Arc<dyn ReplyChannel>,
    pub keys: KeyResolver,
    pub mcp_url: Option<String>,
}

impl EngineService {
    pub fn new(deps: EngineDeps) -> Self {
        Self {
            store: deps.store,
            runtimes: Arc::new(deps.runtimes.into_iter().collect()),
            default_runtime: deps.default_runtime,
            business: deps.business,
            channel: deps.channel,
            keys: deps.keys,
            mcp_url: deps.mcp_url,
            slots: Arc::default(),
            active: Arc::default(),
        }
    }

    /// The engine runtimes and whether each can run here.
    pub fn runtimes(&self) -> Vec<(String, std::result::Result<(), String>)> {
        let mut list: Vec<_> = self.runtimes.iter().map(|(id, r)| (id.clone(), r.check())).collect();
        list.sort_by(|a, b| a.0.cmp(&b.0));
        list
    }

    fn runtime_for(&self, agent: &EngineAgent) -> Result<(String, Arc<dyn AgentRuntime>)> {
        let id = agent
            .runtime
            .clone()
            .filter(|r| self.runtimes.contains_key(r))
            .unwrap_or_else(|| self.default_runtime.clone());
        match self.runtimes.get(&id) {
            Some(runtime) => Ok((id, runtime.clone())),
            None => fail(format!("Runtime do motor indisponível: {id}")),
        }
    }

    fn agent(&self, account_id: i64, agent_id: i64) -> Result<EngineAgent> {
        match self.store.engine_agent(account_id, agent_id)? {
            Some(agent) => Ok(agent),
            None => fail("Agente de IA não encontrado ou inativo nesta organização"),
        }
    }

    fn slot(&self, agent_id: i64, limit: i64) -> Arc<Semaphore> {
        let permits = usize::try_from(limit.clamp(1, 10)).unwrap_or(1);
        self.slots
            .lock()
            .entry(agent_id)
            .or_insert_with(|| Arc::new(Semaphore::new(permits)))
            .clone()
    }

    /// Audit never fails the use case: a lost audit line is logged instead.
    fn audit(
        &self,
        account_id: i64,
        activity: Option<i64>,
        agent: Option<i64>,
        action: &str,
        outcome: &str,
        detail: Value,
    ) {
        if let Err(error) = self.store.audit(account_id, activity, agent, action, outcome, &detail) {
            tracing::warn!(%error, action, "engine audit not recorded");
        }
    }
}
