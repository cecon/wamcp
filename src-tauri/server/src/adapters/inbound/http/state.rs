//! Shared state of the HTTP adapters: the use cases plus listener configuration.
use super::rate_limit::RateLimiter;
use crate::application::accounts::AccountService;
use crate::application::automations::AutomationService;
use crate::application::catalog::CatalogService;
use crate::application::event_bus::EventBus;
use crate::application::events::EventService;
use crate::application::helpdesk::HelpdeskService;
use crate::application::notifications::NotificationService;
use crate::application::oauth::OAuthService;
use crate::application::reports::ReportService;
use crate::application::sessions::{McpService, SessionService};
use crate::application::webhooks::WebhookService;
use std::path::PathBuf;
use std::sync::Arc;

/// Finds the built agent UI (a directory with `agent.html`), re-resolved on every request.
pub type WebDir = Arc<dyn Fn() -> Option<PathBuf> + Send + Sync>;

/// Helpdesk use cases served under `/api/v1`.
#[derive(Clone)]
pub struct Support {
    pub accounts: AccountService,
    pub helpdesk: HelpdeskService,
    pub catalog: CatalogService,
    pub notifications: NotificationService,
    pub webhooks: WebhookService,
    pub automations: AutomationService,
    pub reports: ReportService,
    pub bus: Arc<EventBus>,
    pub web_dir: WebDir,
}

pub struct Services {
    pub public_url: String,
    pub admin_token: String,
    pub sessions: SessionService,
    pub mcp: McpService,
    pub oauth: Option<OAuthService>,
    pub events: Option<EventService>,
    pub support: Option<Support>,
    pub version: String,
    pub limits: Limits,
}

/// Abuse limits per client (keyed by the visitor IP behind the tunnel).
pub struct Limits {
    pub login: RateLimiter,
    pub mcp: RateLimiter,
    pub approve: RateLimiter,
    pub token: RateLimiter,
}

impl Default for Limits {
    fn default() -> Self {
        Self {
            login: RateLimiter::new(10, 900),
            mcp: RateLimiter::new(240, 60),
            approve: RateLimiter::new(30, 600),
            token: RateLimiter::new(50, 900),
        }
    }
}

#[derive(Clone)]
pub struct AppState(pub Arc<Services>);

impl AppState {
    pub fn support(&self) -> &Support {
        self.0.support.as_ref().expect("helpdesk routes are only mounted with support")
    }
}

impl std::ops::Deref for AppState {
    type Target = Services;

    fn deref(&self) -> &Services {
        &self.0
    }
}
