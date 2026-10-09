//! Ports of the product catalog (menu): its store, the browser crawler of iFood store pages and the
//! photo downloader.
use crate::domain::error::Result;
use crate::domain::menu::import::MenuImport;
use crate::domain::menu::{Category, Group, Item, Link, MenuOption, MenuRows, MenuSettings, Product, SizePrice};
use async_trait::async_trait;
use serde_json::Value;
use std::sync::Arc;

/// Catalog rows. `save_*` inserts when `id` is 0 and returns the id.
pub trait MenuRepo {
    fn menu_rows(&self) -> Result<MenuRows>;
    fn menu_settings(&self) -> Result<MenuSettings>;
    fn save_menu_settings(&self, settings: &MenuSettings) -> Result<()>;
    fn save_category(&self, category: &Category) -> Result<i64>;
    fn delete_category(&self, id: i64) -> Result<()>;
    fn save_product(&self, product: &Product) -> Result<i64>;
    fn save_item(&self, item: &Item) -> Result<i64>;
    fn delete_item(&self, id: i64) -> Result<()>;
    /// Replaces the groups linked to an item.
    fn set_item_links(&self, item_id: i64, links: &[Link]) -> Result<()>;
    fn save_group(&self, group: &Group) -> Result<i64>;
    fn delete_group(&self, id: i64) -> Result<()>;
    fn save_option(&self, option: &MenuOption) -> Result<i64>;
    fn delete_option(&self, id: i64) -> Result<()>;
    /// Replaces a topping's per-size prices.
    fn set_size_prices(&self, option_id: i64, prices: &[SizePrice]) -> Result<()>;
    /// Positions 0, 1, 2… in the given order (`categories` or `items`).
    fn set_positions(&self, table: &str, ids: &[i64]) -> Result<()>;
    fn set_items_status(&self, ids: &[i64], status: &str) -> Result<usize>;
    /// Deletes products no item or option points at.
    fn prune_products(&self) -> Result<()>;
    /// Deletes every category, item, group, option and product.
    fn wipe_menu(&self) -> Result<()>;
}

/// iFood import runs (status, preview and captured payload).
pub trait MenuImportRepo {
    fn save_menu_import(&self, import: &MenuImport) -> Result<()>;
    fn menu_import(&self, id: &str) -> Result<Option<MenuImport>>;
    /// Marks imports left running by a previous process as failed.
    fn fail_stale_imports(&self, message: &str) -> Result<()>;
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CrawlStatus {
    /// The browser is starting and opening the store page.
    Opening,
    /// A human-verification page is showing; the person must solve it in the window.
    WaitingHuman,
    /// The store page is loading and being scrolled.
    Loading,
}

/// What the crawler reports to, and asks of, the import that started it.
pub trait CrawlObserver: Send + Sync {
    fn status(&self, status: CrawlStatus);
    /// Whether the payloads captured so far already hold a non-empty menu (the crawl may stop).
    fn complete(&self, payloads: &[Value]) -> bool;
    /// The import was cancelled: close the browser and return.
    fn cancelled(&self) -> bool;
}

/// Opens an iFood store page in the installed browser and captures the JSON that carries the menu
/// (network responses and embedded page data). Never solves human-verification challenges.
#[async_trait]
pub trait MenuCrawler: Send + Sync {
    async fn crawl(&self, url: &str, observer: Arc<dyn CrawlObserver>) -> Result<Vec<Value>>;
}

/// Downloads a photo (https only, bounded size, image content types).
#[async_trait]
pub trait ImageFetcher: Send + Sync {
    async fn fetch(&self, url: &str) -> Result<Vec<u8>>;
}
