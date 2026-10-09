//! Applying a ready import: photos are downloaded first (failures are only counted), then the tree
//! is written in one transaction — `merge` updates and adds, `replace` wipes the catalog first.
use super::merge::Writer;
use super::MenuService;
use crate::domain::actor::Actor;
use crate::domain::error::{fail, fail_with, Result};
use crate::domain::helpdesk::require_admin;
use crate::domain::menu::import::{ImportTree, MenuImport};
use std::collections::{BTreeSet, HashMap};

pub const MODES: [&str; 2] = ["merge", "replace"];

/// Every distinct photo URL of the tree.
fn sources(tree: &ImportTree) -> BTreeSet<String> {
    let mut urls = BTreeSet::new();
    for item in tree.categories.iter().flat_map(|c| &c.items) {
        urls.extend(item.image_url.clone());
        for option in item.groups.iter().flat_map(|g| &g.options) {
            urls.extend(option.image_url.clone());
        }
    }
    urls
}

impl MenuService {
    /// Downloads and stores the photos; returns URL → file name and how many failed.
    async fn download(&self, tree: &ImportTree) -> (HashMap<String, String>, i64) {
        let (mut files, mut failed) = (HashMap::new(), 0);
        for url in sources(tree) {
            let stored = match self.images.fetch(&url).await {
                Ok(bytes) => self.store_image("ifood", &bytes),
                Err(error) => Err(error),
            };
            match stored {
                Ok(file) => {
                    files.insert(url, file);
                }
                Err(_) => failed += 1,
            }
        }
        (files, failed)
    }

    pub async fn apply_import(&self, actor: &Actor, id: &str, mode: &str) -> Result<MenuImport> {
        require_admin(actor)?;
        if !MODES.contains(&mode) {
            return fail("Modo inválido (use merge ou replace)");
        }
        let import = self.import(actor, id)?;
        let (true, Some(tree)) = (import.status == "ready", import.preview.as_ref()) else {
            return fail_with("A importação não está pronta para ser aplicada", 409);
        };
        let (files, failed) = self.download(tree).await;
        let repo = &*self.core.repo;
        let now = self.core.now();
        self.core.commit(Some(actor), |_| {
            // Re-checked inside the transaction so two concurrent applies cannot both write.
            let mut current = self.import(actor, id)?;
            if current.status != "ready" {
                return fail_with("A importação não está pronta para ser aplicada", 409);
            }
            if mode == "replace" {
                repo.wipe_menu()?;
                let mut settings = repo.menu_settings()?;
                settings.pizza_pricing = tree.pizza_pricing.clone();
                repo.save_menu_settings(&settings)?;
            }
            Writer::new(repo, repo.menu_rows()?, &files).write(tree)?;
            repo.prune_products()?;
            current.status = "applied".into();
            current.message = None;
            current.finished_at = Some(now);
            current.counts.images_failed = failed;
            repo.save_menu_import(&current)
        })?;
        self.changed(actor, "import", mode, None);
        self.transition(id, |_| {})
    }
}
