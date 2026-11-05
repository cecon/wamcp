//! Shared fixture for the MCP events service tests: a file-backed store that can be reopened, a
//! controllable callback (blocking gates, statuses, failures) and a manual clock.
#![allow(dead_code)]
pub mod callback;

pub use callback::GateCallback;

use base64::{engine::general_purpose::STANDARD, Engine};
use parking_lot::Mutex;
use serde_json::{json, Value};
use std::collections::HashSet;
use std::sync::Arc;
use std::time::Duration;
use wamcp_server::adapters::outbound::clock::ManualClock;
use wamcp_server::adapters::outbound::sqlite::SqliteStore;
use wamcp_server::application::events::EventService;
use wamcp_server::application::ports::{EventRepo, Subscription};
use wamcp_server::domain::events::EventOwner;
use wamcp_server::domain::model::WaMessage;

pub const JID: &str = "5511999999999@s.whatsapp.net";
pub const OTHER_JID: &str = "5511888888888@s.whatsapp.net";
pub const START: i64 = 1_700_000_000_000;

pub fn secret(fill: u8) -> String {
    format!("whsec_{}", STANDARD.encode([fill; 32]))
}

pub fn owner(session: &str, principal: &str) -> EventOwner {
    EventOwner {
        session_id: session.into(),
        principal_id: principal.into(),
        principal_kind: "token".into(),
    }
}

/// `message.created` subscription params; `extra` keys replace the defaults (like `{...params, ...extra}`).
pub fn params(extra: Value) -> Value {
    let mut base = json!({
        "name": "message.created",
        "arguments": {},
        "delivery": { "mode": "webhook", "url": "https://receiver.example/events", "secret": secret(1) },
    });
    if let (Some(base), Some(extra)) = (base.as_object_mut(), extra.as_object()) {
        for (key, value) in extra {
            base.insert(key.clone(), value.clone());
        }
    }
    base
}

pub fn delivery(url: &str, secret: &str) -> Value {
    json!({ "mode": "webhook", "url": url, "secret": secret })
}

pub fn incoming(id: &str) -> WaMessage {
    WaMessage {
        id: id.into(),
        jid: JID.into(),
        alt_jid: None,
        from_me: false,
        sender: "Alice".into(),
        push_name: None,
        body: "Hello".into(),
        kind: "conversation".into(),
        ts: 100,
    }
}

/// The events service over a reopenable SQLite file with sessions `one` and `two`.
pub struct Env {
    pub dir: tempfile::TempDir,
    pub store: Arc<SqliteStore>,
    pub service: EventService,
    pub callback: Arc<GateCallback>,
    pub clock: Arc<ManualClock>,
    pub revoked: Arc<Mutex<HashSet<String>>>,
}

fn open(dir: &std::path::Path) -> Arc<SqliteStore> {
    let store = Arc::new(SqliteStore::open(dir).expect("store"));
    let sql = "INSERT OR IGNORE INTO sessions(id,name,created) VALUES('one','one','x'),('two','two','x')";
    store.exec(sql, vec![]).expect("sessions");
    store
}

type Revoked = Arc<Mutex<HashSet<String>>>;

fn service(
    store: &Arc<SqliteStore>,
    callback: &Arc<GateCallback>,
    clock: &Arc<ManualClock>,
    revoked: &Revoked,
) -> EventService {
    let revoked = revoked.clone();
    let authorize =
        Arc::new(move |o: &EventOwner| !revoked.lock().contains(&format!("{}/{}", o.session_id, o.principal_id)));
    EventService::new(store.clone(), callback.clone(), clock.clone(), authorize)
}

impl Env {
    pub fn new() -> Self {
        let dir = tempfile::tempdir().expect("temp dir");
        let store = open(dir.path());
        let callback = Arc::new(GateCallback::default());
        let clock = Arc::new(ManualClock::at(START));
        let revoked = Arc::new(Mutex::new(HashSet::new()));
        let service = service(&store, &callback, &clock, &revoked);
        Self {
            dir,
            store,
            service,
            callback,
            clock,
            revoked,
        }
    }

    /// Closes the service and the database, then opens both again over the same file.
    pub fn reopen(&mut self) {
        self.service.close();
        self.store = open(self.dir.path());
        self.service = service(&self.store, &self.callback, &self.clock, &self.revoked);
    }

    pub fn advance(&self, ms: i64) {
        self.clock.set(self.now() + ms);
    }

    pub fn now(&self) -> i64 {
        use wamcp_server::application::ports::Clock;
        self.clock.now_ms()
    }

    pub fn revoke(&self, session: &str, principal: &str) {
        self.revoked.lock().insert(format!("{session}/{principal}"));
    }

    pub fn pending(&self) -> i64 {
        self.store
            .scalar("SELECT COUNT(*) FROM event_queue", vec![])
            .expect("count")
            .unwrap_or(0)
    }

    pub fn list(&self, session: Option<&str>) -> Vec<Subscription> {
        self.store.subscriptions(session).expect("subscriptions")
    }

    pub fn get(&self, id: &str) -> Option<Subscription> {
        self.store.subscription(id).expect("subscription")
    }

    /// Newest-first `(attempt, status, outcome)` rows for a session; nothing else is stored.
    pub fn diagnostics(&self, session: &str) -> Vec<(i64, i64, String)> {
        self.store
            .with(|c| {
                let sql = "SELECT attempt,status,outcome FROM event_attempts WHERE session_id=? ORDER BY id DESC";
                let mut statement = c.prepare(sql)?;
                let rows = statement.query_map([session], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?;
                rows.collect()
            })
            .expect("diagnostics")
    }

    /// Every stored column of the attempts table, to prove no secret, URL or content leaks there.
    pub fn raw_attempts(&self) -> String {
        self.store
            .with(|c| {
                let sql = "SELECT session_id||'|'||subscription_id||'|'||event_id||'|'||attempt||'|'||status||'|'||
                           outcome||'|'||at FROM event_attempts";
                let mut statement = c.prepare(sql)?;
                let rows = statement.query_map([], |r| r.get::<_, String>(0))?;
                rows.collect::<rusqlite::Result<Vec<_>>>()
            })
            .expect("attempts")
            .join("\n")
    }
}

/// Polls until `condition` holds (the services under test run on spawned tasks).
pub async fn until(mut condition: impl FnMut() -> bool) {
    for _ in 0..500 {
        if condition() {
            return;
        }
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
    panic!("condition not reached in time");
}

/// Lets spawned tasks run for a moment without asserting anything.
pub async fn settle() {
    for _ in 0..20 {
        tokio::task::yield_now().await;
    }
    tokio::time::sleep(Duration::from_millis(20)).await;
}
