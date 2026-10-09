//! Test harness: the full stack over SQLite with in-memory WhatsApp, webhook and callback ports.
#![allow(dead_code)]
pub mod filters;
pub mod http;

use async_trait::async_trait;
use parking_lot::Mutex;
use serde_json::{json, Value};
use std::path::Path;
use std::sync::Arc;
use wamcp_server::adapters::outbound::clock::ManualClock;
use wamcp_server::adapters::outbound::crawler::memory::ScriptedCrawler;
use wamcp_server::adapters::outbound::image_fetcher::MemoryImageFetcher;
use wamcp_server::adapters::outbound::media_storage::MemoryMediaStorage;
use wamcp_server::adapters::outbound::sqlite::SqliteStore;
use wamcp_server::adapters::outbound::whatsapp::memory::MemoryWhatsApp;
use wamcp_server::application::event_bus::Envelope;
use wamcp_server::application::ports::{
    CallbackError, CallbackResponse, EventCallback, MirrorRepo, PasswordHasher, SendFailure, WebhookSender,
};
use wamcp_server::compose::{compose, App, Ports, Settings};
use wamcp_server::domain::error::Result;
use wamcp_server::domain::model::{Message, Session, WaMessage};

pub use http::Agent;

pub const PASSWORD: &str = "senha-segura-123";
pub const START: i64 = 1_800_000_000;
pub const ORIGIN: &str = "https://wamcp.cappyfy.com";

/// Hashes without scrypt's cost so tests stay fast (format `plain$<password>`).
pub struct PlainHasher;

#[async_trait]
impl PasswordHasher for PlainHasher {
    async fn hash(&self, password: &str) -> Result<String> {
        Ok(format!("plain${password}"))
    }

    async fn verify(&self, password: &str, stored: &str) -> bool {
        stored == format!("plain${password}")
    }
}

/// Records webhook posts and answers with a configurable status (or a transport failure).
#[derive(Default)]
pub struct RecordingSender {
    pub posts: Mutex<Vec<(String, Value, String)>>,
    pub status: Mutex<Option<std::result::Result<u16, SendFailure>>>,
}

#[async_trait]
impl WebhookSender for RecordingSender {
    fn secret(&self) -> String {
        "test-secret".into()
    }

    async fn post(&self, url: &str, body: &Value, secret: &str) -> std::result::Result<u16, SendFailure> {
        self.posts.lock().push((url.into(), body.clone(), secret.into()));
        self.status.lock().unwrap_or(Ok(200))
    }
}

/// MCP event callbacks: verification and deliveries are recorded; outcomes are configurable.
#[derive(Default)]
pub struct RecordingCallback {
    pub verified: Mutex<Vec<(String, String)>>,
    pub delivered: Mutex<Vec<(String, Vec<String>, Value)>>,
    pub verify_error: Mutex<Option<String>>,
    pub status: Mutex<Option<u16>>,
}

#[async_trait]
impl EventCallback for RecordingCallback {
    async fn verify(&self, url: &str, _subscription: &str, secret: &str) -> std::result::Result<(), CallbackError> {
        self.verified.lock().push((url.into(), secret.into()));
        match self.verify_error.lock().clone() {
            Some(reason) => Err(CallbackError { reason }),
            None => Ok(()),
        }
    }

    async fn deliver(
        &self,
        url: &str,
        _subscription: &str,
        secrets: &[String],
        event: &Value,
    ) -> std::result::Result<CallbackResponse, CallbackError> {
        self.delivered
            .lock()
            .push((url.into(), secrets.to_vec(), event.clone()));
        match *self.status.lock() {
            Some(0) => Err(CallbackError {
                reason: "delivery_failed".into(),
            }),
            Some(status) => Ok(CallbackResponse {
                status,
                body: String::new(),
            }),
            None => Ok(CallbackResponse {
                status: 200,
                body: String::new(),
            }),
        }
    }
}

pub struct Fixture {
    pub app: App,
    pub store: Arc<SqliteStore>,
    pub wa: Arc<MemoryWhatsApp>,
    pub sender: Arc<RecordingSender>,
    pub callback: Arc<RecordingCallback>,
    pub clock: Arc<ManualClock>,
    pub storage: Arc<MemoryMediaStorage>,
    pub crawler: Arc<ScriptedCrawler>,
    pub images: Arc<MemoryImageFetcher>,
    pub events: Arc<Mutex<Vec<Envelope>>>,
    pub dir: Option<tempfile::TempDir>,
    /// The administrator session used by `admin()` and `bootstrap()`, created on first use.
    pub admin_agent: Mutex<Option<Agent>>,
}

/// Options for a live WhatsApp message simulated through the adapter sink.
pub struct Incoming<'a> {
    pub id: &'a str,
    pub jid: &'a str,
    pub body: &'a str,
    pub from_me: bool,
    pub ts: Option<i64>,
    pub name: &'a str,
}

impl Default for Incoming<'_> {
    fn default() -> Self {
        Self {
            id: "IN1",
            jid: "5511988887777@s.whatsapp.net",
            body: "Olá",
            from_me: false,
            ts: None,
            name: "Cliente",
        }
    }
}

impl Fixture {
    pub async fn new() -> Self {
        Self::build(Arc::new(SqliteStore::in_memory().expect("store")), None, None)
    }

    /// A fixture over a database directory prepared by `prepare` before the store opens.
    pub async fn with_dir(prepare: impl FnOnce(&Path)) -> Self {
        let dir = tempfile::tempdir().expect("temp dir");
        prepare(dir.path());
        let store = Arc::new(SqliteStore::open(dir.path()).expect("store"));
        Self::build(store, Some(dir), None)
    }

    pub async fn with_web(web: &Path) -> Self {
        Self::build(
            Arc::new(SqliteStore::in_memory().expect("store")),
            None,
            Some(web.to_path_buf()),
        )
    }

    fn build(store: Arc<SqliteStore>, dir: Option<tempfile::TempDir>, web: Option<std::path::PathBuf>) -> Self {
        let wa = Arc::new(MemoryWhatsApp::default());
        let sender = Arc::new(RecordingSender::default());
        let callback = Arc::new(RecordingCallback::default());
        let clock = Arc::new(ManualClock::at(START * 1000));
        let storage = Arc::new(MemoryMediaStorage::default());
        let crawler = Arc::new(ScriptedCrawler::default());
        let images = Arc::new(MemoryImageFetcher::default());
        let ports = Ports {
            repo: store.clone(),
            whatsapp: wa.clone(),
            hasher: Arc::new(PlainHasher),
            sender: sender.clone(),
            callback: callback.clone(),
            clock: clock.clone(),
            storage: storage.clone(),
            crawler: crawler.clone(),
            images: images.clone(),
        };
        let settings = Settings {
            public_url: ORIGIN.into(),
            version: "test".into(),
            web_dir: Arc::new(move || web.clone()),
        };
        let app = compose(ports, settings);
        let events = Arc::new(Mutex::new(Vec::new()));
        let recorded = events.clone();
        app.state
            .support()
            .bus
            .subscribe(move |e| recorded.lock().push(e.clone()));
        Self {
            app,
            store,
            wa,
            sender,
            callback,
            clock,
            storage,
            crawler,
            images,
            events,
            dir,
            admin_agent: Mutex::new(None),
        }
    }

    pub fn session(&self, name: &str) -> Session {
        self.store.create_session(name).expect("session")
    }

    pub fn now(&self) -> i64 {
        self.clock.now_secs()
    }

    pub fn tick(&self, seconds: i64) {
        self.clock.advance_secs(seconds);
    }

    pub async fn settle(&self) {
        self.app.settle().await;
    }

    pub fn event_names(&self) -> Vec<String> {
        self.events.lock().iter().map(|e| e.event.clone()).collect()
    }

    /// Simulates a live WhatsApp message arriving through the connection adapter.
    pub fn incoming(&self, session_id: &str, m: Incoming) -> Option<Message> {
        let message = WaMessage {
            id: m.id.into(),
            jid: m.jid.into(),
            alt_jid: None,
            from_me: m.from_me,
            sender: if m.from_me { m.jid.into() } else { m.name.into() },
            push_name: (!m.from_me).then(|| m.name.to_string()),
            body: m.body.into(),
            kind: "conversation".into(),
            ts: m.ts.unwrap_or_else(|| self.now()),
        };
        let _ = self.store.store_message(session_id, &message, None);
        self.app
            .state
            .support()
            .helpdesk
            .ingest(session_id, &message)
            .expect("ingest")
    }

    /// The first administrator ("Admin", admin@example.com), created through first-run setup.
    pub async fn bootstrap(&self) -> Agent {
        if let Some(admin) = self.admin_agent.lock().clone() {
            return admin;
        }
        let body = json!({ "name": "Admin", "email": "admin@example.com", "password": PASSWORD });
        let reply = self.admin("POST", "/api/helpdesk/bootstrap", Some(body)).await;
        assert_eq!(reply.status, 201, "bootstrap: {:?}", reply.body);
        let admin = self.login("admin@example.com", PASSWORD).await.expect("admin login");
        *self.admin_agent.lock() = Some(admin.clone());
        admin
    }

    /// Creates an agent (optionally in the first inbox) and logs in as them.
    pub async fn agent(&self, admin: &Agent, email: &str, role: &str, in_inbox: bool) -> Agent {
        let inboxes = admin.get("/inboxes").await.body;
        let inbox_ids = if in_inbox { json!([inboxes[0]["id"]]) } else { json!([]) };
        let name = email.split('@').next().unwrap_or(email);
        let body = json!({ "name": name, "email": email, "role": role, "password": PASSWORD, "inbox_ids": inbox_ids });
        let created = admin.post("/agents", body).await;
        assert_eq!(created.status, 201, "agent: {:?}", created.body);
        self.login(email, PASSWORD).await.expect("agent login")
    }
}
