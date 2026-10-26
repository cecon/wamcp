//! iFood import inside the app: the store page opens in a window of this app (its WebView, so a
//! human verification passed there is remembered) and `ifood.js` reads the menu from the site's own
//! API and reports it through `ifood_report`. Human verification is never solved: the window waits
//! for the person. Only that window may report, and only while an import runs.
use serde_json::Value;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tokio::sync::mpsc::{unbounded_channel, UnboundedReceiver, UnboundedSender};
use wamcp_server::application::ports::{CrawlObserver, CrawlStatus, MenuCrawler};
use wamcp_server::domain::error::{fail, Result};

pub const LABEL: &str = "ifood-import";
const SCRIPT: &str = include_str!("ifood.js");
const MAX_PAYLOAD: usize = 8 * 1024 * 1024;
const MAX_PAYLOADS: usize = 1000;

pub enum Report {
    Status(CrawlStatus),
    Payload(Value),
    Done,
    Failed(&'static str),
}

/// Where the window's reports go while an import runs.
#[derive(Clone, Default)]
pub struct Bridge(Arc<Mutex<Option<UnboundedSender<Report>>>>);

impl Bridge {
    fn connect(&self, sender: Option<UnboundedSender<Report>>) {
        if let Ok(mut current) = self.0.lock() {
            *current = sender;
        }
    }
}

#[tauri::command]
pub fn ifood_report(
    window: WebviewWindow,
    bridge: tauri::State<'_, Bridge>,
    kind: String,
    payload: Value,
) -> std::result::Result<(), String> {
    if window.label() != LABEL {
        return Err("Não permitido".into());
    }
    let report = match (kind.as_str(), payload.as_str()) {
        ("challenge", _) => Report::Status(CrawlStatus::WaitingHuman),
        ("loading", _) => Report::Status(CrawlStatus::Loading),
        ("payload", _) if payload.to_string().len() <= MAX_PAYLOAD => Report::Payload(payload),
        ("done", _) => Report::Done,
        ("failed", Some("no_store")) => Report::Failed("Use o link da página de uma loja do iFood (…/delivery/…)."),
        ("failed", _) => Report::Failed("O iFood não devolveu o cardápio desta loja. Tente de novo em instantes."),
        _ => return Err("Relatório inválido".into()),
    };
    if let Some(sender) = bridge.0.lock().ok().and_then(|s| s.clone()) {
        let _ = sender.send(report);
    }
    Ok(())
}

/// The `MenuCrawler` of the desktop app.
pub struct WindowCrawler {
    pub app: AppHandle,
    pub bridge: Bridge,
}

#[async_trait::async_trait]
impl MenuCrawler for WindowCrawler {
    async fn crawl(&self, url: &str, observer: Arc<dyn CrawlObserver>) -> Result<Vec<Value>> {
        observer.status(CrawlStatus::Opening);
        if let Some(previous) = self.app.get_webview_window(LABEL) {
            let _ = previous.destroy();
        }
        let Ok(address) = url.parse() else {
            return fail("Link da loja inválido");
        };
        let (sender, mut reports) = unbounded_channel();
        self.bridge.connect(Some(sender));
        let window = WebviewWindowBuilder::new(&self.app, LABEL, WebviewUrl::External(address))
            .title("Importar cardápio do iFood")
            .inner_size(1180.0, 820.0)
            .initialization_script(SCRIPT)
            .build();
        let result = match window {
            Ok(window) => {
                let _ = window.set_focus();
                let result = self.listen(&mut reports, observer.as_ref()).await;
                let _ = window.destroy();
                result
            }
            Err(_) => fail("Não foi possível abrir a janela do iFood"),
        };
        self.bridge.connect(None);
        result
    }
}

impl WindowCrawler {
    async fn listen(
        &self,
        reports: &mut UnboundedReceiver<Report>,
        observer: &dyn CrawlObserver,
    ) -> Result<Vec<Value>> {
        let mut payloads = Vec::new();
        let mut ticker = tokio::time::interval(Duration::from_millis(500));
        loop {
            tokio::select! {
                report = reports.recv() => match report {
                    Some(Report::Status(status)) => observer.status(status),
                    Some(Report::Payload(payload)) if payloads.len() < MAX_PAYLOADS => payloads.push(payload),
                    Some(Report::Payload(_)) => {}
                    Some(Report::Done) | None => return Ok(payloads),
                    Some(Report::Failed(message)) => return fail(message),
                },
                _ = ticker.tick() => {
                    if observer.cancelled() {
                        return Ok(payloads);
                    }
                    if self.app.get_webview_window(LABEL).is_none() {
                        return fail("A janela do iFood foi fechada antes de terminar a importação");
                    }
                }
            }
        }
    }
}
