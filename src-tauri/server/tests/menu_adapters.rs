//! Catalog outbound adapters without a network or browser: browser discovery, the crawler stand-ins
//! and the photo downloader's address guard.
use serde_json::{json, Value};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use wamcp_server::adapters::outbound::crawler::memory::{Script, ScriptedCrawler};
use wamcp_server::adapters::outbound::crawler::{candidates, find_browser, UnavailableCrawler};
use wamcp_server::adapters::outbound::image_fetcher::{HttpImageFetcher, MemoryImageFetcher};
use wamcp_server::application::ports::{CrawlObserver, CrawlStatus, ImageFetcher, MenuCrawler};
use wamcp_server::domain::error::Error;

#[derive(Default)]
struct Observer {
    seen: parking_lot::Mutex<Vec<CrawlStatus>>,
    cancel: AtomicBool,
}

impl CrawlObserver for Observer {
    fn status(&self, status: CrawlStatus) {
        self.seen.lock().push(status);
    }
    fn complete(&self, payloads: &[Value]) -> bool {
        !payloads.is_empty()
    }
    fn cancelled(&self) -> bool {
        self.cancel.load(Ordering::SeqCst)
    }
}

fn message<T: std::fmt::Debug>(result: Result<T, Error>) -> String {
    match result {
        Err(Error::Helpdesk(e)) => e.message,
        other => panic!("{other:?}"),
    }
}

#[test]
fn the_configured_browser_comes_first_then_edge_then_chrome() {
    let dir = tempfile::tempdir().unwrap();
    let browser = dir.path().join("browser.exe");
    std::fs::write(&browser, b"").unwrap();
    std::env::set_var("WAMCP_BROWSER", &browser);
    let list = candidates();
    assert_eq!(list[0], browser);
    let edge = list
        .iter()
        .position(|p| p.to_string_lossy().contains("msedge"))
        .unwrap();
    let chrome = list
        .iter()
        .position(|p| p.to_string_lossy().ends_with("chrome.exe"))
        .unwrap();
    assert!(edge < chrome);
    assert_eq!(find_browser(), Some(browser));
    std::env::remove_var("WAMCP_BROWSER");
}

#[tokio::test]
async fn without_the_crawler_feature_imports_explain_why() {
    let observer: Arc<dyn CrawlObserver> = Arc::new(Observer::default());
    let result = UnavailableCrawler.crawl("https://www.ifood.com.br/x", observer).await;
    assert_eq!(
        message(result),
        "A importação do iFood não está disponível nesta versão"
    );
}

#[tokio::test]
async fn the_scripted_crawler_reports_holds_and_returns_payloads() {
    let crawler = Arc::new(ScriptedCrawler::default());
    crawler.set(Script {
        statuses: vec![CrawlStatus::Opening, CrawlStatus::WaitingHuman, CrawlStatus::Loading],
        payloads: vec![json!({ "menu": [] })],
        hold: true,
        ..Script::default()
    });
    let observer = Arc::new(Observer::default());
    let running = {
        let (crawler, observer) = (crawler.clone(), observer.clone());
        tokio::spawn(async move { crawler.crawl("https://www.ifood.com.br/a", observer).await })
    };
    tokio::time::sleep(std::time::Duration::from_millis(20)).await;
    assert!(!running.is_finished(), "holds like a browser waiting for a person");
    crawler.release();
    let payloads = running.await.unwrap().unwrap();
    assert_eq!(payloads.len(), 1);
    assert!(crawler.complete.load(Ordering::SeqCst));
    assert_eq!(observer.seen.lock().len(), 3);
    crawler.set(Script {
        error: Some("Falhou".into()),
        ..Script::default()
    });
    assert_eq!(
        message(crawler.crawl("https://www.ifood.com.br/b", observer).await),
        "Falhou"
    );
    assert_eq!(crawler.urls.lock().len(), 2);
}

#[tokio::test]
async fn photos_are_only_fetched_from_allowed_https_addresses() {
    let fetcher = HttpImageFetcher::default();
    for blocked in [
        "http://example.com/a.jpg",
        "https://127.0.0.1/a.jpg",
        "https://localhost/a.jpg",
        "file:///c:/a.jpg",
    ] {
        assert_eq!(
            message(fetcher.fetch(blocked).await),
            "Endereço de imagem não permitido",
            "{blocked}"
        );
    }
    let memory = MemoryImageFetcher::default();
    memory
        .images
        .lock()
        .insert("https://cdn.example.com/a.jpg".into(), vec![1, 2]);
    assert_eq!(memory.fetch("https://cdn.example.com/a.jpg").await.unwrap(), vec![1, 2]);
    assert_eq!(
        message(memory.fetch("https://cdn.example.com/b.jpg").await),
        "Não foi possível baixar a imagem"
    );
    assert_eq!(memory.requests.lock().len(), 2);
}
