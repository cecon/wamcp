//! iFood imports run as background tasks: the crawler opens the store in the installed browser,
//! reports its progress (stored and emitted as `catalog.import.updated`) and returns the captured
//! JSON, which is converted into the preview. One import runs at a time; cancelling closes the browser.
use super::MenuService;
use crate::application::ports::{CrawlObserver, CrawlStatus};
use crate::domain::actor::Actor;
use crate::domain::error::{fail_with, Error, HelpdeskError, Result};
use crate::domain::helpdesk::require_admin;
use crate::domain::menu::import::web::{store_url, RUNNING, WAITING_HUMAN};
use crate::domain::menu::import::{convert, counts, MenuImport};
use serde_json::Value;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Instant;

const NOT_FOUND: &str = "Não encontramos o cardápio na página. Confira o link da loja e tente de novo.";
const TIMEOUT: &str = "A importação passou do limite de 5 minutos sem encontrar o cardápio.";

/// The crawler's view of one import.
struct Observer {
    service: MenuService,
    id: String,
    cancel: Arc<AtomicBool>,
    deadline: Instant,
}

impl CrawlObserver for Observer {
    fn status(&self, status: CrawlStatus) {
        let (name, message) = match status {
            CrawlStatus::Opening => ("opening", None),
            CrawlStatus::WaitingHuman => ("waiting_human", Some(WAITING_HUMAN.to_string())),
            CrawlStatus::Loading => ("loading", None),
        };
        if !self.cancelled() {
            let _ = self.service.transition(&self.id, |import| {
                import.status = name.into();
                import.message = message;
            });
        }
    }

    fn complete(&self, payloads: &[Value]) -> bool {
        convert(payloads).is_some()
    }

    fn cancelled(&self) -> bool {
        self.cancel.load(Ordering::SeqCst) || Instant::now() >= self.deadline
    }
}

fn reason(error: &Error) -> String {
    match error {
        Error::Helpdesk(e) => e.message.clone(),
        Error::Internal(_) => "Não foi possível abrir o navegador para importar o cardápio.".into(),
    }
}

impl MenuService {
    fn load_import(&self, id: &str) -> Result<MenuImport> {
        self.core
            .repo
            .menu_import(id)?
            .ok_or_else(|| HelpdeskError::not_found("Importação não encontrada").into())
    }

    /// Changes a stored import, saves it and announces the new state.
    pub(crate) fn transition(&self, id: &str, change: impl FnOnce(&mut MenuImport)) -> Result<MenuImport> {
        let mut import = self.load_import(id)?;
        change(&mut import);
        if !RUNNING.contains(&import.status.as_str()) && import.finished_at.is_none() {
            import.finished_at = Some(self.core.now());
        }
        self.core.repo.save_menu_import(&import)?;
        self.core.emit("catalog.import.updated", &import, None);
        Ok(import)
    }

    pub fn import(&self, actor: &Actor, id: &str) -> Result<MenuImport> {
        require_admin(actor)?;
        self.load_import(id)
    }

    /// Starts importing the store at `url` (https on ifood.com.br) in the background.
    pub fn start_import(&self, actor: &Actor, url: &str) -> Result<MenuImport> {
        require_admin(actor)?;
        let url = store_url(url)?;
        let cancel = Arc::new(AtomicBool::new(false));
        let import = MenuImport {
            id: uuid::Uuid::new_v4().to_string(),
            url,
            status: "starting".into(),
            started_at: self.core.now(),
            ..MenuImport::default()
        };
        {
            let mut running = self.running.lock();
            if !running.is_empty() {
                return fail_with("Já existe uma importação em andamento", 409);
            }
            running.insert(import.id.clone(), cancel.clone());
        }
        if let Err(error) = self.core.repo.save_menu_import(&import) {
            self.running.lock().remove(&import.id);
            return Err(error);
        }
        self.core.emit("catalog.import.updated", &import, Some(actor));
        let service = self.clone();
        let (id, address) = (import.id.clone(), import.url.clone());
        tokio::spawn(async move { service.run_import(id, address, cancel).await });
        Ok(import)
    }

    async fn run_import(&self, id: String, url: String, cancel: Arc<AtomicBool>) {
        let observer = Arc::new(Observer {
            service: self.clone(),
            id: id.clone(),
            cancel: cancel.clone(),
            deadline: Instant::now() + self.crawl_limit,
        });
        let limit = self.crawl_limit + std::time::Duration::from_secs(60);
        let crawled = tokio::time::timeout(limit, self.crawler.crawl(&url, observer.clone())).await;
        self.running.lock().remove(&id);
        if cancel.load(Ordering::SeqCst) {
            return;
        }
        let _ = self.transition(&id, |import| match crawled {
            Ok(Ok(payloads)) => match convert(&payloads) {
                Some(tree) => {
                    import.status = "ready".into();
                    import.message = None;
                    import.counts = counts(&tree);
                    import.preview = Some(tree);
                    import.payload = Value::Array(payloads);
                }
                None => {
                    import.status = "failed".into();
                    let timed_out = observer.cancelled();
                    import.message = Some(if timed_out { TIMEOUT } else { NOT_FOUND }.into());
                    import.payload = Value::Array(payloads);
                }
            },
            Ok(Err(error)) => {
                import.status = "failed".into();
                import.message = Some(reason(&error));
            }
            Err(_) => {
                import.status = "failed".into();
                import.message = Some(TIMEOUT.into());
            }
        });
    }

    /// Cancels a running import (the crawler closes the browser) or discards a ready preview.
    pub fn cancel_import(&self, actor: &Actor, id: &str) -> Result<MenuImport> {
        require_admin(actor)?;
        let import = self.load_import(id)?;
        if import.status == "cancelled" {
            return Ok(import);
        }
        if !RUNNING.contains(&import.status.as_str()) && import.status != "ready" {
            return fail_with("A importação já terminou", 409);
        }
        if let Some(flag) = self.running.lock().remove(id) {
            flag.store(true, Ordering::SeqCst);
        }
        self.transition(id, |import| {
            import.status = "cancelled".into();
            import.message = None;
        })
    }
}
