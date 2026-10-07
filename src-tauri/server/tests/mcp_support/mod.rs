//! MCP endpoint harness shared by the `mcp_*` test targets: a session with real tokens (reader,
//! writer and an OAuth grant), request helpers mirroring the Node fixture and optional port hooks.
#![allow(dead_code)]
pub mod golden;
mod hooks;
mod oauth;

pub use hooks::{HookedCallback, HookedWhatsApp};
pub use oauth::oauth_grant;

use crate::common::http::{request, send, Reply};
use crate::common::{Fixture, PlainHasher, RecordingCallback, RecordingSender, ADMIN_TOKEN, ORIGIN, START};
use axum::Router;
use base64::{engine::general_purpose::STANDARD, Engine};
use parking_lot::Mutex;
use serde_json::{json, Map, Value};
use std::sync::Arc;
use wamcp_server::adapters::inbound::http::public_router;
use wamcp_server::adapters::inbound::http::state::{AppState, Limits, Services};
use wamcp_server::adapters::outbound::clock::ManualClock;
use wamcp_server::adapters::outbound::sqlite::SqliteStore;
use wamcp_server::adapters::outbound::whatsapp::memory::MemoryWhatsApp;
use wamcp_server::application::ports::MirrorRepo;
use wamcp_server::compose::{compose, Ports, Settings};
use wamcp_server::domain::model::{MediaMetadata, Session, WaMessage};

pub const VERSION: &str = "2026-07-28";
pub const JID: &str = "5511999999999@s.whatsapp.net";

pub fn envelope() -> Value {
    json!({
        "io.modelcontextprotocol/protocolVersion": VERSION,
        "io.modelcontextprotocol/clientCapabilities": {},
        "io.modelcontextprotocol/clientInfo": { "name": "events-test", "version": "1.0.0" },
    })
}

pub fn subscription() -> Value {
    let secret = format!("whsec_{}", STANDARD.encode([1u8; 32]));
    json!({
        "name": "message.created",
        "arguments": { "jid": JID },
        "delivery": { "mode": "webhook", "url": "https://receiver.example/mcp-events/callback", "secret": secret },
        "cursor": null,
    })
}

/// Shallow merge of JSON objects (later keys win), like `{ ...a, ...b }`.
pub fn merge(base: &Value, extra: &Value) -> Value {
    let mut out: Map<String, Value> = base.as_object().cloned().unwrap_or_default();
    for (k, v) in extra.as_object().into_iter().flatten() {
        out.insert(k.clone(), v.clone());
    }
    Value::Object(out)
}

/// One session with a read token, a read_write token and a read OAuth grant.
pub struct Mcp {
    pub f: Fixture,
    pub router: Router,
    pub session: Session,
    pub reader: String,
    pub reader_id: String,
    pub writer: String,
    pub writer_id: String,
    pub oauth: String,
    pub grant_id: String,
    pub wa_hooks: Arc<HookedWhatsApp>,
    pub callback_hooks: Arc<HookedCallback>,
}

impl Mcp {
    pub async fn new() -> Self {
        let store = Arc::new(SqliteStore::in_memory().expect("store"));
        let wa = Arc::new(MemoryWhatsApp::default());
        let callback = Arc::new(RecordingCallback::default());
        let wa_hooks = Arc::new(HookedWhatsApp {
            inner: wa.clone(),
            on_media: Mutex::new(None),
        });
        let callback_hooks = Arc::new(HookedCallback {
            inner: callback.clone(),
            on_verify: Mutex::new(None),
        });
        let sender = Arc::new(RecordingSender::default());
        let clock = Arc::new(ManualClock::at(START * 1000));
        let storage = Arc::new(wamcp_server::adapters::outbound::media_storage::MemoryMediaStorage::default());
        let ports = Ports {
            repo: store.clone(),
            whatsapp: wa_hooks.clone(),
            hasher: Arc::new(PlainHasher),
            sender: sender.clone(),
            callback: callback_hooks.clone(),
            clock: clock.clone(),
            storage: storage.clone(),
        };
        let settings = Settings {
            public_url: ORIGIN.into(),
            admin_token: ADMIN_TOKEN.into(),
            version: "test".into(),
            web_dir: Arc::new(|| None),
        };
        let app = compose(ports, settings);
        let events = Arc::new(Mutex::new(Vec::new()));
        let f = Fixture {
            app,
            store,
            wa,
            sender,
            callback,
            clock,
            storage,
            events,
            dir: None,
        };
        let session = f.session("Session A");
        let read = f
            .store
            .issue_token(&session.id, "reader", "read", 30)
            .expect("reader token");
        let write = f
            .store
            .issue_token(&session.id, "writer", "read_write", 30)
            .expect("writer token");
        let (oauth, grant_id) = oauth_grant(&f, &session.id, "read");
        let router = f.app.public_router();
        Self {
            f,
            router,
            session,
            reader: read.token,
            reader_id: read.id,
            writer: write.token,
            writer_id: write.id,
            oauth,
            grant_id,
            wa_hooks,
            callback_hooks,
        }
    }

    /// Serves the endpoint without the events service and/or the helpdesk (Node's optional services).
    pub fn without(&mut self, events: bool, helpdesk: bool) {
        let s = &self.f.app.state;
        let mut mcp = s.mcp.clone();
        if helpdesk {
            mcp.helpdesk = None;
        }
        let services = Services {
            public_url: s.public_url.clone(),
            admin_token: s.admin_token.clone(),
            sessions: s.sessions.clone(),
            mcp,
            oauth: s.oauth.clone(),
            events: if events { None } else { s.events.clone() },
            support: s.support.clone(),
            version: s.version.clone(),
            limits: Limits::default(),
        };
        self.router = public_router(AppState(Arc::new(services)));
    }

    pub fn credential(&self, name: &str) -> String {
        match name {
            "reader" => self.reader.clone(),
            "writer" => self.writer.clone(),
            "oauth" => self.oauth.clone(),
            other => other.to_string(),
        }
    }

    /// Sends like the Node fixture's `raw`: bearer, JSON, protocol version and routing headers.
    pub async fn raw(&self, body: Option<Value>, credential: &str, extra: &[(&str, &str)], method: &str) -> Reply {
        self.raw_to(&self.session.id, body, credential, extra, method).await
    }

    pub async fn raw_to(&self, id: &str, body: Option<Value>, cred: &str, extra: &[(&str, &str)], verb: &str) -> Reply {
        let auth = format!("Bearer {}", self.credential(cred));
        let mut headers: Vec<(String, String)> = vec![
            ("authorization".into(), auth),
            ("accept".into(), "application/json, text/event-stream".into()),
            ("mcp-protocol-version".into(), VERSION.into()),
        ];
        let b = body.clone().unwrap_or(Value::Null);
        if let Some(m) = b.get("method").and_then(Value::as_str).filter(|m| !m.is_empty()) {
            headers.push(("mcp-method".into(), m.into()));
        }
        let name = b.get("params").and_then(|p| p.get("name")).and_then(Value::as_str);
        if let Some(n) = name.filter(|n| !n.is_empty()) {
            headers.push(("mcp-name".into(), n.into()));
        }
        for (name, value) in extra {
            headers.retain(|(n, _)| !n.eq_ignore_ascii_case(name));
            headers.push((name.to_ascii_lowercase(), (*value).into()));
        }
        let pairs: Vec<(&str, &str)> = headers.iter().map(|(n, v)| (n.as_str(), v.as_str())).collect();
        let body = if verb == "POST" { body } else { None };
        send(&self.router, request(verb, &format!("/mcp/{id}"), body, &pairs)).await
    }

    pub async fn rpc(&self, method: &str, params: Value, credential: &str, extra: &[(&str, &str)]) -> Reply {
        let params = merge(&json!({ "_meta": envelope() }), &params);
        let body = json!({ "jsonrpc": "2.0", "id": "request-1", "method": method, "params": params });
        self.raw(Some(body), credential, extra, "POST").await
    }

    /// Stores a mirrored message (optionally with audio media) in this session's history.
    pub fn mirror(&self, id: &str, body: &str, audio: bool) {
        let message = WaMessage {
            id: id.into(),
            jid: JID.into(),
            alt_jid: None,
            from_me: false,
            sender: "Contact".into(),
            push_name: Some("Contact".into()),
            body: body.into(),
            kind: if audio { "audioMessage" } else { "conversation" }.into(),
            ts: START,
        };
        let metadata = MediaMetadata {
            kind: "audio".into(),
            mime_type: "audio/ogg".into(),
            file_name: None,
            size: Some(4),
            duration: None,
            voice: true,
        };
        let media = audio.then_some((&metadata, &b"opaque-payload"[..]));
        self.f
            .store
            .store_message(&self.session.id, &message, media)
            .expect("mirror message");
        *self.f.wa.media.lock() = Some(vec![1, 2, 3, 4]);
    }

    pub fn audit_count(&self) -> usize {
        self.f
            .store
            .audit_events(&self.session.id)
            .map(|a| a.len())
            .unwrap_or_default()
    }
}
