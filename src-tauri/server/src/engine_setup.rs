//! Wires the agentic engine into the app: its store, runtimes, the simulated finance tools, the
//! helpdesk as reply channel and model keys from the agents' encrypted credentials.
use crate::adapters::outbound::finance_mock::FinanceMock;
use crate::application::engine::{EngineDeps, EngineService, HelpdeskChannel};
use crate::application::ports::{AgentRuntime, EngineRepo};
use crate::compose::App;
use crate::domain::llm::openrouter_key;
use std::sync::Arc;

impl App {
    /// Attaches the engine (once); `mcp_url` is where runtimes reach `/engine/mcp`.
    pub fn attach_engine(
        &self,
        store: Arc<dyn EngineRepo>,
        runtimes: Vec<(String, Arc<dyn AgentRuntime>)>,
        default_runtime: &str,
        mcp_url: Option<String>,
    ) -> EngineService {
        let support = self.state.support();
        let (core, secrets) = (support.agents.core.clone(), support.agents.secrets.clone());
        let keys = Arc::new(move |agent: &crate::domain::engine::model::EngineAgent| {
            let credentials = core.repo.agent_sealed_credentials(agent.id).ok()?;
            let sealed = openrouter_key(&credentials)?;
            secrets.open(&sealed.secret).ok()
        });
        let engine = EngineService::new(EngineDeps {
            store,
            runtimes,
            default_runtime: default_runtime.into(),
            business: Arc::new(FinanceMock),
            channel: Arc::new(HelpdeskChannel(support.helpdesk.clone())),
            keys,
            mcp_url,
        });
        support.engine.get_or_init(|| engine).clone()
    }
}
