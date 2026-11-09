//! Composition root: wires the SQLite store, the WhatsApp port and the event listeners into the use
//! cases and the HTTP routers. Shared by the server entry point and the integration tests.
use crate::adapters::inbound::http::public_router;
use crate::adapters::inbound::http::state::{AppState, Limits, Services, Support, WebDir};
use crate::application::accounts::AccountService;
use crate::application::agent_runs::AgentRuns;
use crate::application::agents::AgentDirectory;
use crate::application::auto_replies::AutoReplyService;
use crate::application::automations::AutomationService;
use crate::application::avatars::AvatarService;
use crate::application::catalog::CatalogService;
use crate::application::core::Core;
use crate::application::event_bus::{EventBus, Worker};
use crate::application::events::EventService;
use crate::application::helpdesk::HelpdeskService;
use crate::application::llm_bots::LlmBotService;
use crate::application::notifications::NotificationService;
use crate::application::oauth::OAuthService;
use crate::application::ports::{
    Clock, EventCallback, GithubApi, ImageFetcher, Llm, MediaStorage, PasswordHasher, Repository, SecretBox,
    WebhookSender, WhatsApp,
};
use crate::application::reports::ReportService;
use crate::application::sessions::{McpService, SessionService};
use crate::application::system_agent::SystemAgent;
use crate::application::webhooks::WebhookService;
use crate::application::whatsapp_sink::WhatsAppSink;
use axum::Router;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, OnceLock};
use std::time::Duration;
use tokio::task::JoinHandle;

/// Everything the application needs from the outside world.
pub struct Ports {
    pub repo: Arc<dyn Repository>,
    pub whatsapp: Arc<dyn WhatsApp>,
    pub hasher: Arc<dyn PasswordHasher>,
    pub sender: Arc<dyn WebhookSender>,
    pub callback: Arc<dyn EventCallback>,
    pub clock: Arc<dyn Clock>,
    pub storage: Arc<dyn MediaStorage>,
    /// Downloads contact avatars.
    pub images: Arc<dyn ImageFetcher>,
    /// Encrypts agent credentials at rest.
    pub secrets: Arc<dyn SecretBox>,
    /// The GitHub REST API (GitHub inboxes).
    pub github: Arc<dyn GithubApi>,
}

pub struct Settings {
    pub public_url: String,
    pub version: String,
    pub web_dir: WebDir,
}

/// The wired application: HTTP state plus the background workers and the WhatsApp sink.
pub struct App {
    pub state: AppState,
    pub workers: Vec<Worker>,
    pub sink: Arc<WhatsAppSink>,
    /// Answers conversations of `llm` bots once `attach_llm` gave it a provider.
    pub llm_bots: Option<LlmBotService>,
    /// The system agent's MCP endpoint on this computer, set once the server listens.
    pub mcp_url: Arc<OnceLock<String>>,
}

/// Builds every service and subscribes the event listeners (must run inside a Tokio runtime).
pub fn compose(ports: Ports, settings: Settings) -> App {
    let bus = Arc::new(EventBus::default());
    let core = Core {
        repo: ports.repo.clone(),
        bus: bus.clone(),
        clock: ports.clock.clone(),
        runs: Arc::new(AgentRuns::new(bus.clone())),
    };
    let helpdesk = HelpdeskService {
        core: core.clone(),
        whatsapp: ports.whatsapp.clone(),
        storage: ports.storage.clone(),
        github: ports.github.clone(),
        secrets: ports.secrets.clone(),
        github_runs: Default::default(),
    };
    let notifications = NotificationService { core: core.clone() };
    let webhooks = WebhookService {
        core: core.clone(),
        sender: ports.sender.clone(),
        delivering: Arc::new(AtomicBool::new(false)),
    };
    let automations = AutomationService {
        helpdesk: helpdesk.clone(),
    };
    let reports = ReportService { core: core.clone() };
    let auto_replies = AutoReplyService {
        helpdesk: helpdesk.clone(),
    };
    let oauth = OAuthService {
        repo: ports.repo.clone(),
        clock: ports.clock.clone(),
        public_url: settings.public_url.clone(),
    };
    let events = EventService::new(
        ports.repo.clone(),
        ports.callback.clone(),
        ports.clock.clone(),
        crate::engine_setup::authorizer(ports.repo.clone(), oauth.clone()),
    );

    let listener = notifications.clone();
    bus.subscribe(move |e| drop(listener.on_event(e)));
    let listener = webhooks.clone();
    bus.subscribe(move |e| drop(listener.enqueue(e)));
    let rules = automations.clone();
    let automation_worker = Worker::spawn(Arc::new(move |e| {
        let rules = rules.clone();
        Box::pin(async move { rules.on_event(e).await })
    }));
    let worker = automation_worker.clone();
    bus.subscribe(move |e| worker.push(e));
    let listener = reports.clone();
    bus.subscribe(move |e| drop(listener.on_event(e)));
    let replies = auto_replies.clone();
    let reply_worker = Worker::spawn(Arc::new(move |e| {
        let replies = replies.clone();
        Box::pin(async move { replies.on_event(e).await })
    }));
    let worker = reply_worker.clone();
    bus.subscribe(move |e| worker.push(e));
    let downloads = helpdesk.clone();
    let media_worker = Worker::spawn(Arc::new(move |e| {
        let downloads = downloads.clone();
        Box::pin(async move { downloads.prefetch(&e).await })
    }));
    let worker = media_worker.clone();
    bus.subscribe(move |e| worker.push(e));
    let avatars = AvatarService::new(helpdesk.clone(), ports.images.clone());
    let photos = avatars.clone();
    let avatar_worker = Worker::spawn(Arc::new(move |e| {
        let photos = photos.clone();
        Box::pin(async move { photos.on_event(e).await })
    }));
    let worker = avatar_worker.clone();
    bus.subscribe(move |e| worker.push(e));
    let plugins = crate::engine_setup::plugins(ports.repo.clone(), ports.secrets.clone(), helpdesk.clone());
    let (engine, answers, live) = crate::engine_setup::live(ports.repo.clone());
    let agents = AgentDirectory {
        core: core.clone(),
        secrets: ports.secrets.clone(),
        llm: Arc::default(),
    };
    let support = Support {
        system: SystemAgent::new(agents.clone()),
        chats: crate::application::agent_chats::AgentChatService { core: core.clone() },
        schedules: crate::application::agent_schedules::AgentScheduleService::new(core.clone()),
        agents,
        engine,
        answers,
        live,
        plugins,
        avatars,
        accounts: AccountService {
            core: core.clone(),
            hasher: ports.hasher.clone(),
        },
        helpdesk: helpdesk.clone(),
        catalog: CatalogService { core: core.clone() },
        notifications,
        webhooks,
        automations,
        reports,
        bus,
        web_dir: settings.web_dir,
    };
    let sessions = SessionService {
        repo: ports.repo.clone(),
        whatsapp: ports.whatsapp.clone(),
        events: Some(events.clone()),
    };
    let mcp = McpService {
        repo: ports.repo.clone(),
        whatsapp: ports.whatsapp.clone(),
        oauth: Some(oauth.clone()),
        helpdesk: Some(helpdesk.clone()),
    };
    let sink = Arc::new(WhatsAppSink {
        repo: ports.repo.clone(),
        helpdesk: Some(helpdesk),
        events: Some(events.clone()),
    });
    let state = AppState(Arc::new(Services {
        public_url: settings.public_url,
        sessions,
        mcp,
        oauth: Some(oauth),
        events: Some(events),
        support: Some(support),
        version: settings.version,
        limits: Limits::default(),
    }));
    App {
        state,
        workers: vec![automation_worker, reply_worker, media_worker, avatar_worker],
        sink,
        llm_bots: None,
        mcp_url: Arc::default(),
    }
}

impl App {
    pub fn public_router(&self) -> Router {
        public_router(self.state.clone())
    }

    /// Lets AI agents (and `llm` bots) answer their inboxes with `llm`, which also tells which runtimes
    /// are installed (debounce groups a burst of messages).
    pub fn attach_llm(&mut self, llm: Arc<dyn Llm>, debounce: Duration) {
        let support = self.state.support();
        support.agents.attach_llm(llm.clone());
        let secrets = support.agents.secrets.clone();
        let bots = LlmBotService::new(support.helpdesk.clone(), llm, secrets, debounce, 2)
            .with_system(support.system.clone(), self.mcp_url.clone())
            .with_engine(support.engine.clone());
        support.schedules.attach(bots.clone());
        let _ = support.answers.set(bots.clone());
        let listener = bots.clone();
        support.bus.subscribe(move |e| listener.on_event(e));
        self.llm_bots = Some(bots);
    }

    /// Waits until automations and auto-replies have processed every queued event.
    pub async fn settle(&self) {
        for _ in 0..3 {
            for worker in &self.workers {
                worker.settle().await;
            }
            tokio::task::yield_now().await;
        }
        if let Some(bots) = &self.llm_bots {
            bots.settle().await;
            self.state.support().schedules.settle().await;
            for worker in &self.workers {
                worker.settle().await;
            }
        }
    }

    /// Periodic jobs: snoozes, auto-resolve and SLAs, webhooks, schedules, GitHub deliveries, AI watchdog and MCP events.
    pub fn start_jobs(&self) -> Vec<JoinHandle<()>> {
        let support = self.state.support();
        crate::application::jobs::start(
            support.helpdesk.clone(),
            support.webhooks.clone(),
            support.schedules.clone(),
            self.llm_bots.clone(),
            self.state.events.clone(),
        )
    }
}
