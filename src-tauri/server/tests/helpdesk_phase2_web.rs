//! Helpdesk phase 2: the agent web app served on the public listener.
mod common;

use common::http::{request, send, Reply};
use common::{Fixture, PlainHasher, RecordingCallback, RecordingSender, ORIGIN, START};
use parking_lot::Mutex;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use wamcp_server::adapters::outbound::clock::ManualClock;
use wamcp_server::adapters::outbound::sqlite::SqliteStore;
use wamcp_server::adapters::outbound::whatsapp::memory::MemoryWhatsApp;
use wamcp_server::compose::{compose, App, Ports, Settings};

/// Writes a built web app (index.html plus one asset) into `dir`.
fn build_web(dir: &Path) {
    std::fs::create_dir_all(dir.join("assets")).expect("assets dir");
    std::fs::write(dir.join("index.html"), "<!doctype html><title>Atendimento</title>").expect("index.html");
    std::fs::write(dir.join("assets").join("app.js"), "console.log(1)").expect("app.js");
}

async fn get(app: &App, path: &str) -> Reply {
    send(&app.public_router(), request("GET", path, None, &[])).await
}

#[tokio::test]
async fn the_agent_web_app_is_served_with_a_strict_csp() {
    let web = tempfile::tempdir().expect("web dir");
    build_web(web.path());
    let f = Fixture::with_web(web.path()).await;
    let page = get(&f.app, "/app/").await;
    assert_eq!(page.status, 200);
    assert!(page.text.contains("Atendimento"));
    assert!(page
        .header("content-security-policy")
        .unwrap_or_default()
        .contains("frame-ancestors 'none'"));
    assert_eq!(get(&f.app, "/app/assets/app.js").await.status, 200);
    assert_eq!(get(&f.app, "/").await.header("location").as_deref(), Some("/app/"));
    let legacy = get(&f.app, "/agent.html").await;
    assert_eq!(legacy.header("location").as_deref(), Some("/app/"));
}

#[tokio::test]
async fn the_agent_web_app_appears_once_built_without_restarting_the_service() {
    // The shared fixture fixes the web directory at start; this one resolves it on every request.
    let web_dir: Arc<Mutex<Option<PathBuf>>> = Arc::new(Mutex::new(None));
    let resolved = web_dir.clone();
    let ports = Ports {
        repo: Arc::new(SqliteStore::in_memory().expect("store")),
        whatsapp: Arc::new(MemoryWhatsApp::default()),
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
        web_dir: Arc::new(move || resolved.lock().clone()),
    };
    let app = compose(ports, settings);
    assert_eq!(get(&app, "/app/").await.status, 503);
    assert_eq!(get(&app, "/app/assets/app.js").await.status, 404);
    let web = tempfile::tempdir().expect("web dir");
    build_web(web.path());
    *web_dir.lock() = Some(web.path().to_path_buf());
    assert_eq!(get(&app, "/app/").await.status, 200);
    assert_eq!(get(&app, "/app/assets/app.js").await.status, 200);
}
