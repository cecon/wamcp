//! A scripted crawler for tests: reports the scripted statuses, optionally holds (like a browser
//! waiting for a person) until released or cancelled, then returns the scripted payloads or error.
use crate::application::ports::{CrawlObserver, CrawlStatus, MenuCrawler};
use crate::domain::error::{fail, Result};
use async_trait::async_trait;
use parking_lot::Mutex;
use serde_json::Value;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

#[derive(Debug, Clone, Default)]
pub struct Script {
    pub statuses: Vec<CrawlStatus>,
    pub payloads: Vec<Value>,
    pub error: Option<String>,
    /// Wait after the statuses until `release()` or cancellation.
    pub hold: bool,
}

#[derive(Default)]
pub struct ScriptedCrawler {
    pub script: Mutex<Script>,
    /// URLs crawled, in order.
    pub urls: Mutex<Vec<String>>,
    /// Whether the last crawl saw the import cancelled (the real adapter closes the browser).
    pub closed_by_cancel: AtomicBool,
    /// What `observer.complete` answered for the payloads.
    pub complete: AtomicBool,
    released: AtomicBool,
}

impl ScriptedCrawler {
    pub fn set(&self, script: Script) {
        self.released.store(false, Ordering::SeqCst);
        *self.script.lock() = script;
    }

    pub fn release(&self) {
        self.released.store(true, Ordering::SeqCst);
    }
}

#[async_trait]
impl MenuCrawler for ScriptedCrawler {
    async fn crawl(&self, url: &str, observer: Arc<dyn CrawlObserver>) -> Result<Vec<Value>> {
        self.urls.lock().push(url.into());
        let script = self.script.lock().clone();
        for status in script.statuses {
            observer.status(status);
            tokio::task::yield_now().await;
        }
        while script.hold && !self.released.load(Ordering::SeqCst) && !observer.cancelled() {
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
        if observer.cancelled() {
            self.closed_by_cancel.store(true, Ordering::SeqCst);
            return Ok(Vec::new());
        }
        if let Some(error) = script.error {
            return fail(error);
        }
        self.complete
            .store(observer.complete(&script.payloads), Ordering::SeqCst);
        Ok(script.payloads)
    }
}
