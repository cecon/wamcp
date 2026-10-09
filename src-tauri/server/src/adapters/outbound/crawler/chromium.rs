//! The real crawler: launches the installed Edge/Chrome **visible**, with its own profile in
//! `<data dir>/browser` (so a passed human verification is remembered), opens the store page and
//! listens to its network responses through the DevTools Protocol. It keeps JSON responses from
//! catalog/menu/site-api endpoints, reads `__NEXT_DATA__`, scrolls gradually to trigger lazy loading
//! and stops once the captured data converts to a menu, on cancel or when the import times out.
//! Human-verification pages are only reported (`waiting_human`) — never clicked or solved.
use super::find_browser;
use crate::application::ports::{CrawlObserver, CrawlStatus, MenuCrawler};
use crate::domain::error::{fail, HelpdeskError, Result};
use crate::domain::menu::import::web::{is_challenge, is_menu_response};
use async_trait::async_trait;
use base64::{engine::general_purpose::STANDARD, Engine};
use chromiumoxide::cdp::browser_protocol::network::{
    EnableParams, EventLoadingFinished, EventResponseReceived, GetResponseBodyParams,
};
use chromiumoxide::cdp::browser_protocol::page::NavigateParams;
use chromiumoxide::{Browser, BrowserConfig, Page};
use futures::StreamExt;
use serde_json::Value;
use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

const CHALLENGE_FRAME: &str = "!!document.querySelector('iframe[src*=\"challenges.cloudflare.com\"], \
     iframe[src*=\"captcha\"], #px-captcha, #challenge-form, iframe[title*=\"hallenge\"]')";
const NEXT_DATA: &str = "document.getElementById('__NEXT_DATA__')?.textContent ?? null";
const SCROLL: &str = "window.scrollBy(0, Math.max(400, Math.floor(window.innerHeight * 0.8)))";
const MAX_BODY: usize = 20 * 1024 * 1024;
const MAX_PAYLOADS: usize = 60;

pub struct ChromiumCrawler {
    /// Browser profile directory (`<data dir>/browser`).
    pub profile: PathBuf,
}

fn unavailable() -> HelpdeskError {
    HelpdeskError::new("Não foi possível abrir o navegador para importar o cardápio")
}

#[async_trait]
impl MenuCrawler for ChromiumCrawler {
    async fn crawl(&self, url: &str, observer: Arc<dyn CrawlObserver>) -> Result<Vec<Value>> {
        observer.status(CrawlStatus::Opening);
        let Some(executable) = find_browser() else {
            return fail("Instale o Microsoft Edge ou o Google Chrome para importar do iFood");
        };
        let config = BrowserConfig::builder()
            .chrome_executable(executable)
            .with_head()
            .user_data_dir(&self.profile)
            .window_size(1280, 900)
            .viewport(None::<chromiumoxide::handler::viewport::Viewport>)
            .disable_default_args()
            .args(["no-first-run", "no-default-browser-check"])
            .arg(("lang", "pt-BR"))
            .launch_timeout(Duration::from_secs(30))
            .build()
            .map_err(|_| unavailable())?;
        let (mut browser, mut handler) = Browser::launch(config).await.map_err(|_| unavailable())?;
        let pump = tokio::spawn(async move { while handler.next().await.is_some_and(|e| e.is_ok()) {} });
        let captured = capture(&browser, url, observer.as_ref()).await;
        let _ = browser.close().await;
        let _ = browser.wait().await;
        pump.abort();
        captured
    }
}

async fn text_of(page: &Page, script: &str) -> Option<String> {
    page.evaluate(script)
        .await
        .ok()?
        .into_value::<Option<String>>()
        .ok()
        .flatten()
}

async fn body(page: &Page, event: &EventLoadingFinished) -> Option<Value> {
    let reply = page
        .execute(GetResponseBodyParams::new(event.request_id.clone()))
        .await
        .ok()?;
    let raw = if reply.base64_encoded {
        String::from_utf8(STANDARD.decode(&reply.body).ok()?).ok()?
    } else {
        reply.body.clone()
    };
    (raw.len() <= MAX_BODY).then(|| serde_json::from_str(&raw).ok())?
}

async fn capture(browser: &Browser, url: &str, observer: &dyn CrawlObserver) -> Result<Vec<Value>> {
    let page = browser.new_page("about:blank").await.map_err(|_| unavailable())?;
    let started = async {
        page.execute(EnableParams::default()).await?;
        let responses = page.event_listener::<EventResponseReceived>().await?;
        let finished = page.event_listener::<EventLoadingFinished>().await?;
        page.execute(NavigateParams::new(url)).await?;
        Ok::<_, chromiumoxide::error::CdpError>((responses, finished))
    };
    let (mut responses, mut finished) = started.await.map_err(|_| unavailable())?;
    let (mut tracked, mut payloads, mut embedded) = (HashSet::new(), Vec::new(), HashSet::new());
    let mut ticker = tokio::time::interval(Duration::from_millis(1500));
    let mut reported = None;
    while !observer.cancelled() {
        tokio::select! {
            Some(event) = responses.next() => {
                if is_menu_response(&event.response.url, &event.response.mime_type) {
                    tracked.insert(event.request_id.clone());
                }
            }
            Some(event) = finished.next() => {
                if tracked.remove(&event.request_id) && payloads.len() < MAX_PAYLOADS {
                    payloads.extend(body(&page, &event).await);
                }
            }
            _ = ticker.tick() => {
                let title = page.get_title().await.ok().flatten().unwrap_or_default();
                let frame = page.evaluate(CHALLENGE_FRAME).await.ok()
                    .and_then(|r| r.into_value::<bool>().ok()).unwrap_or(false);
                let status = if is_challenge(&title, frame) { CrawlStatus::WaitingHuman } else { CrawlStatus::Loading };
                if reported != Some(status) {
                    observer.status(status);
                    reported = Some(status);
                }
                if status == CrawlStatus::WaitingHuman {
                    continue;
                }
                if let Some(data) = text_of(&page, NEXT_DATA).await {
                    if embedded.insert(data.len()) {
                        payloads.extend(serde_json::from_str::<Value>(&data).ok());
                    }
                }
                if observer.complete(&payloads) {
                    break;
                }
                let _ = page.evaluate(SCROLL).await;
            }
        }
    }
    Ok(payloads)
}
