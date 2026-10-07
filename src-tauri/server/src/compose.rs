//! Composition root: wires the SQLite store, the WhatsApp port and the event listeners into the use
//! cases and the HTTP routers. Shared by the server entry point and the integration tests.
use crate::adapters::inbound::http::state::{AppState, Limits, Services, Support, WebDir};
use crate::adapters::inbound::http::{admin_router, public_router};
use crate::application::accounts::AccountService;
use crate::application::auto_replies::AutoReplyService;
use crate::application::automations::AutomationService;
use crate::application::catalog::CatalogService;
use crate::application::core::Core;
use crate::application::event_bus::{EventBus, Worker};
use crate::application::events::EventService;
use crate::application::helpdesk::HelpdeskService;
use crate::application::notifications::NotificationService;
use crate::application::oauth::OAuthService;
use crate::application::ports::{
    Clock, EventCallback, MediaStorage, PasswordHasher, Repository, WebhookSender, WhatsApp,
};
use crate::application::reports::ReportService;
use crate::application::sessions::{McpService, SessionService};
use crate::application::webhooks::WebhookService;
use crate::application::whatsapp_sink::WhatsAppSink;
use crate::domain::events::EventOwner;
use axum::Router;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
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
}

pub struct Settings {
    pub public_url: String,
    pub admin_token: String,
    pub version: String,
    pub web_dir: WebDir,
}

/// The wired application: HTTP state plus the background workers and the WhatsApp sink.
pub struct App {
    pub state: AppState,
    pub workers: Vec<Worker>,
    pub sink: Arc<WhatsAppSink>,
}

fn authorizer(repo: Arc<dyn Repository>, oauth: OAuthService) -> Arc<dyn Fn(&EventOwner) -> bool + Send + Sync> {
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

/// Builds every service and subscribes the event listeners (must run inside a Tokio runtime).
pub fn compose(ports: Ports, settings: Settings) -> App {
    let bus = Arc::new(EventBus::default());
    let core = Core {
        repo: ports.repo.clone(),
        bus: bus.clone(),
        clock: ports.clock.clone(),
    };
    let helpdesk = HelpdeskService {
        core: core.clone(),
        whatsapp: ports.whatsapp.clone(),
        storage: ports.storage.clone(),
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
        authorizer(ports.repo.clone(), oauth.clone()),
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

    let support = Support {
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
        admin_token: settings.admin_token,
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
        workers: vec![automation_worker, reply_worker, media_worker],
        sink,
    }
}

impl App {
    pub fn admin_router(&self) -> Router {
        admin_router(self.state.clone())
    }

    pub fn public_router(&self) -> Router {
        public_router(self.state.clone())
    }

    /// Waits until automations and auto-replies have processed every queued event.
    pub async fn settle(&self) {
        for _ in 0..3 {
            for worker in &self.workers {
                worker.settle().await;
            }
            tokio::task::yield_now().await;
        }
    }

    /// Periodic jobs: snooze wake-ups (60 s), webhook deliveries (10 s) and MCP events (1 s).
    pub fn start_jobs(&self) -> Vec<JoinHandle<()>> {
        let support = self.state.support().clone();
        let helpdesk = support.helpdesk.clone();
        let snoozes = tokio::spawn(async move {
            let mut ticker = tokio::time::interval(Duration::from_secs(60));
            loop {
                ticker.tick().await;
                let _ = helpdesk.wake_snoozed();
            }
        });
        let webhooks = support.webhooks.clone();
        let deliveries = tokio::spawn(async move {
            let mut ticker = tokio::time::interval(Duration::from_secs(10));
            loop {
                ticker.tick().await;
                let _ = webhooks.deliver_due().await;
            }
        });
        let mut jobs = vec![snoozes, deliveries];
        if let Some(events) = self.state.events.clone() {
            jobs.push(tokio::spawn(async move {
                let mut ticker = tokio::time::interval(Duration::from_secs(1));
                loop {
                    ticker.tick().await;
                    events.flush().await;
                }
            }));
        }
        jobs
    }
}
