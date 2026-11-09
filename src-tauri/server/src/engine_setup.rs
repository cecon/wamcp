//! Wires the agentic engine into the app: its store, runtimes, the simulated finance tools, the
//! helpdesk as reply channel and model keys from the agents' encrypted credentials; and the plugins.
use crate::adapters::outbound::finance_mock::{self, FinanceMock};
use crate::adapters::outbound::plugin_transport::HttpPluginTransport;
use crate::application::engine::{EngineDeps, EngineService, HelpdeskChannel};
use crate::application::helpdesk::HelpdeskService;
use crate::application::oauth::OAuthService;
use crate::application::plugins::messaging::{self, MessagingTools};
use crate::application::plugins::PluginService;
use crate::application::ports::{AgentRuntime, BusinessTools, EngineRepo, Repository, SecretBox};
use crate::compose::App;
use crate::domain::events::EventOwner;
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
            business: Arc::new(support.plugins.clone()),
            channel: Arc::new(HelpdeskChannel(support.helpdesk.clone())),
            keys,
            mcp_url,
        });
        support.engine.get_or_init(|| engine).clone()
    }
}

/// The plugin service with the plugins that ship with the app (the simulated finance system).
/// A failure to install them leaves the app without plugins, never without its other services.
pub fn plugins(repo: Arc<dyn Repository>, secrets: Arc<dyn SecretBox>, helpdesk: HelpdeskService) -> PluginService {
    let transport = Arc::new(HttpPluginTransport::new());
    let finance: (serde_json::Value, Arc<dyn BusinessTools>) = (finance_mock::manifest(), Arc::new(FinanceMock));
    let messaging: (serde_json::Value, Arc<dyn BusinessTools>) =
        (messaging::manifest(), Arc::new(MessagingTools(helpdesk)));
    let builtins = vec![finance, messaging];
    PluginService::new(repo.clone(), secrets.clone(), transport.clone(), builtins).unwrap_or_else(|error| {
        tracing::error!(%error, "plugins do app não instalados");
        PluginService::new(repo, secrets, transport, Vec::new()).expect("sem plugins não há o que instalar")
    })
}

/// Whether an MCP event subscription's owner (a token or an OAuth grant) still exists.
pub fn authorizer(repo: Arc<dyn Repository>, oauth: OAuthService) -> Arc<dyn Fn(&EventOwner) -> bool + Send + Sync> {
    Arc::new(move |owner: &EventOwner| {
        let exists = matches!(repo.session(&owner.session_id), Ok(Some(_)));
        exists
            && match owner.principal_kind.as_str() {
                "oauth" => oauth.event_principal(&owner.session_id, &owner.principal_id).is_some(),
                "token" => matches!(
                    repo.event_principal(&owner.session_id, &owner.principal_id),
                    Ok(Some(_))
                ),
                _ => false,
            }
    })
}

type Slot<T> = Arc<std::sync::OnceLock<T>>;

/// The slots the engine and the conversation answers fill once attached, and the live view over both.
pub fn live(
    repo: Arc<dyn Repository>,
) -> (
    Slot<EngineService>,
    Slot<crate::application::llm_bots::LlmBotService>,
    crate::application::live::LiveService,
) {
    let (engine, answers) = (Slot::default(), Slot::default());
    let live = crate::application::live::LiveService::new(repo, answers.clone(), engine.clone());
    (engine, answers, live)
}
