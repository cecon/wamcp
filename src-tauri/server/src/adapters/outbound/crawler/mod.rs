//! Menu crawlers: the real one drives the installed Edge/Chrome through the DevTools Protocol
//! (feature `crawler`); the scripted one replays payloads in tests; without the feature imports are
//! unavailable.
#[cfg(feature = "crawler")]
pub mod chromium;
pub mod memory;

use crate::application::ports::{CrawlObserver, MenuCrawler};
use crate::domain::error::{fail, Result};
use async_trait::async_trait;
use serde_json::Value;
use std::path::PathBuf;
use std::sync::Arc;

/// Browser executables tried in order: `WAMCP_BROWSER`, `CHROME_PATH`, Edge, then Chrome/Chromium.
pub fn candidates() -> Vec<PathBuf> {
    let mut paths: Vec<PathBuf> = ["WAMCP_BROWSER", "CHROME_PATH"]
        .iter()
        .filter_map(std::env::var_os)
        .map(PathBuf::from)
        .collect();
    paths.extend(
        [
            r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
            r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
            r"C:\Program Files\Google\Chrome\Application\chrome.exe",
            r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
            "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            "/usr/bin/microsoft-edge",
            "/usr/bin/google-chrome",
            "/usr/bin/chromium",
            "/usr/bin/chromium-browser",
        ]
        .map(PathBuf::from),
    );
    if let Some(local) = std::env::var_os("LOCALAPPDATA").map(PathBuf::from) {
        paths.push(local.join(r"Google\Chrome\Application\chrome.exe"));
    }
    paths
}

/// The first installed browser.
pub fn find_browser() -> Option<PathBuf> {
    candidates().into_iter().find(|p| p.is_file())
}

/// Used when the server is built without the `crawler` feature.
pub struct UnavailableCrawler;

#[async_trait]
impl MenuCrawler for UnavailableCrawler {
    async fn crawl(&self, _url: &str, _observer: Arc<dyn CrawlObserver>) -> Result<Vec<Value>> {
        fail("A importação do iFood não está disponível nesta versão")
    }
}
