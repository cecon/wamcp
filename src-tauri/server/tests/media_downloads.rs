//! Media (port of tests/media.test.mjs): the MCP `get_media` tool hides internal download failures
//! and re-checks the credential after downloading.
mod common;
mod media_support;

use async_trait::async_trait;
use common::{PlainHasher, RecordingCallback, RecordingSender, ORIGIN, START};
use media_support::{call, get_media, store_audio, JID};
use parking_lot::Mutex;
use serde_json::json;
use std::sync::Arc;
use wamcp_server::adapters::outbound::clock::ManualClock;
use wamcp_server::adapters::outbound::sqlite::SqliteStore;
use wamcp_server::application::ports::{MirrorRepo, WhatsApp};
use wamcp_server::compose::{compose, App, Ports, Settings};
use wamcp_server::domain::error::{Error, Result};
use wamcp_server::domain::model::ConnectionDetail;

/// A WhatsApp port whose download runs a hook: revoking the token or failing with an internal error.
struct HookedWhatsApp {
    store: Arc<SqliteStore>,
    revoke: Mutex<Option<(String, String)>>,
    downloads: Mutex<usize>,
}

#[async_trait]
impl WhatsApp for HookedWhatsApp {
    async fn connect(&self, _session_id: &str) -> Result<()> {
        Ok(())
    }

    async fn stop(&self, _session_id: &str, _logout: bool) -> Result<()> {
        Ok(())
    }

    fn detail(&self, _session_id: &str) -> ConnectionDetail {
        ConnectionDetail::default()
    }

    async fn media(&self, _session_id: &str, _payload: &[u8]) -> Result<Vec<u8>> {
        *self.downloads.lock() += 1;
        match self.revoke.lock().clone() {
            Some((session, token)) => {
                self.store.revoke(&session, &token)?;
                Ok(b"data".to_vec())
            }
            None => Err(Error::internal("secret-url-and-key")),
        }
    }

    fn new_message_id(&self) -> String {
        "OUT1".into()
    }

    async fn send(&self, _session_id: &str, _jid: &str, _text: &str, _message_id: Option<&str>) -> Result<String> {
        Ok("OUT1".into())
    }
}

fn hooked() -> (App, Arc<SqliteStore>, Arc<HookedWhatsApp>) {
    let store = Arc::new(SqliteStore::in_memory().expect("store"));
    let wa = Arc::new(HookedWhatsApp {
        store: store.clone(),
        revoke: Mutex::new(None),
        downloads: Mutex::new(0),
    });
    let ports = Ports {
        repo: store.clone(),
        whatsapp: wa.clone(),
        hasher: Arc::new(PlainHasher),
        sender: Arc::new(RecordingSender::default()),
        callback: Arc::new(RecordingCallback::default()),
        clock: Arc::new(ManualClock::at(START * 1000)),
        storage: Arc::new(wamcp_server::adapters::outbound::media_storage::MemoryMediaStorage::default()),
        crawler: Arc::new(wamcp_server::adapters::outbound::crawler::memory::ScriptedCrawler::default()),
        images: Arc::new(wamcp_server::adapters::outbound::image_fetcher::MemoryImageFetcher::default()),
    };
    let settings = Settings {
        public_url: ORIGIN.into(),
        version: "test".into(),
        web_dir: Arc::new(|| None),
    };
    (compose(ports, settings), store, wa)
}

#[tokio::test]
async fn internal_download_failures_are_hidden() {
    let (app, store, wa) = hooked();
    let session = store.create_session("Media").expect("session");
    let token = MirrorRepo::issue_token(&*store, &session.id, "Reader", "read", 90)
        .expect("token")
        .token;
    store_audio(&store, &session.id, "audio", 4);
    let error = get_media(&app, &session.id, &token, JID, "audio").await;
    assert_eq!(error["isError"], true);
    assert_eq!(*wa.downloads.lock(), 1);
    assert!(!error.to_string().contains("secret-url-and-key"), "{error}");
}

#[tokio::test]
async fn revocation_during_download_prevents_releasing_content() {
    let (app, store, wa) = hooked();
    let session = store.create_session("Media").expect("session");
    let issued = MirrorRepo::issue_token(&*store, &session.id, "Reader", "read", 90).expect("token");
    store_audio(&store, &session.id, "audio", 4);
    *wa.revoke.lock() = Some((session.id.clone(), issued.id.clone()));
    let result = get_media(&app, &session.id, &issued.token, JID, "audio").await;
    assert_eq!(result["isError"], true);
    assert!(
        result["_meta"]["mcp/www_authenticate"][0].as_str().is_some(),
        "{result}"
    );
    assert!(!result.to_string().contains("ZGF0YQ=="));
    let again = call(
        &app,
        &session.id,
        &issued.token,
        "get_media",
        json!({ "jid": JID, "messageId": "audio" }),
    )
    .await;
    assert_eq!(again.status, 401);
    assert!(!again.text.contains("ZGF0YQ=="));
}
