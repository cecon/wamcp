//! Product catalog (menu) use cases: any authenticated agent (or the inbox bot) reads, only
//! administrators write. Every change emits `catalog.updated`; imports emit `catalog.import.updated`.
mod apply;
mod categories;
mod groups;
mod images;
mod imports;
mod items;
mod merge;
mod read;

use super::core::Core;
use super::ports::{ImageFetcher, MediaStorage, MenuCrawler};
use crate::domain::actor::Actor;
use crate::domain::error::{HelpdeskError, Result};
use crate::domain::menu::assemble::Assembler;
use crate::domain::menu::{Category, GroupView, ItemView, Menu, MenuRows, MenuSettings};
use parking_lot::Mutex;
use serde_json::json;
use std::collections::HashMap;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use std::time::Duration;

#[derive(Clone)]
pub struct MenuService {
    pub core: Core,
    pub storage: Arc<dyn MediaStorage>,
    pub crawler: Arc<dyn MenuCrawler>,
    pub images: Arc<dyn ImageFetcher>,
    /// Cancel flags of the imports being crawled, by import id.
    pub running: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
    /// How long a crawl may take before it is given up (5 minutes).
    pub crawl_limit: Duration,
}

/// One consistent read of the catalog.
pub struct Snapshot {
    pub rows: MenuRows,
    pub settings: MenuSettings,
    pub now: i64,
}

impl Snapshot {
    pub fn assembler(&self) -> Assembler<'_> {
        Assembler::new(&self.rows, &self.settings, self.now)
    }
}

impl MenuService {
    pub fn new(
        core: Core,
        storage: Arc<dyn MediaStorage>,
        crawler: Arc<dyn MenuCrawler>,
        images: Arc<dyn ImageFetcher>,
    ) -> Self {
        let _ = core.repo.fail_stale_imports("A importação foi interrompida");
        Self {
            core,
            storage,
            crawler,
            images,
            running: Arc::default(),
            crawl_limit: Duration::from_secs(300),
        }
    }

    pub fn snapshot(&self) -> Result<Snapshot> {
        Ok(Snapshot {
            rows: self.core.repo.menu_rows()?,
            settings: self.core.repo.menu_settings()?,
            now: self.core.now(),
        })
    }

    /// The whole menu, optionally only what can be ordered now.
    pub fn menu(&self, only_available: bool) -> Result<Menu> {
        Ok(self.snapshot()?.assembler().menu(only_available))
    }

    pub(crate) fn category_row(&self, snapshot: &Snapshot, id: i64) -> Result<Category> {
        snapshot
            .rows
            .categories
            .iter()
            .find(|c| c.id == id)
            .cloned()
            .ok_or_else(|| HelpdeskError::not_found("Categoria não encontrada").into())
    }

    pub fn item(&self, _actor: &Actor, id: i64) -> Result<ItemView> {
        self.snapshot()?
            .assembler()
            .item(id)
            .ok_or_else(|| HelpdeskError::not_found("Item não encontrado").into())
    }

    pub fn group(&self, _actor: &Actor, id: i64) -> Result<GroupView> {
        self.snapshot()?
            .assembler()
            .group(id)
            .ok_or_else(|| HelpdeskError::not_found("Grupo não encontrado").into())
    }

    /// Announces a catalog change to the web app and integrations.
    pub(crate) fn changed(&self, actor: &Actor, entity: &str, action: &str, id: Option<i64>) {
        let data = json!({ "entity": entity, "action": action, "id": id });
        self.core.emit("catalog.updated", &data, Some(actor));
    }
}
