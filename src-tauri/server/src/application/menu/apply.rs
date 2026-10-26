//! Applying a ready import: it turns `applying` (a second apply is refused), photos are downloaded
//! a few at a time with the progress announced (failures are only counted), then the tree is
//! written in one transaction — `merge` updates and adds, `replace` wipes the catalog first.
use super::merge::Writer;
use super::MenuService;
use crate::domain::actor::Actor;
use crate::domain::error::{fail, fail_with, Error, Result};
use crate::domain::helpdesk::require_admin;
use crate::domain::menu::import::{ImportProgress, ImportTree, MenuImport};
use futures::StreamExt;
use serde_json::json;
use std::collections::{BTreeSet, HashMap};
use std::time::{Duration, Instant};

pub const MODES: [&str; 2] = ["merge", "replace"];
/// Photos downloaded at the same time.
const PARALLEL: usize = 6;
/// Least time between two progress announcements.
const REPORT_EVERY: Duration = Duration::from_millis(250);
const NOT_READY: &str = "A importação não está pronta para ser aplicada";

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
    /// Turns a ready import into `applying` and returns its tree; refused if it is not ready.
    fn claim(&self, actor: &Actor, id: &str) -> Result<ImportTree> {
        // Held while checking and changing the status, so two applies cannot both claim it.
        let mut running = self.running.lock();
        let import = self.import(actor, id)?;
        let (true, Some(tree)) = (import.status == "ready", import.preview) else {
            return fail_with(NOT_READY, 409);
        };
        self.transition(id, |import| {
            import.status = "applying".into();
            import.message = None;
        })?;
        running.insert(id.into(), Default::default());
        Ok(tree)
    }

    /// Records and announces how many photos were downloaded.
    fn report(&self, id: &str, progress: ImportProgress) {
        self.progress.lock().insert(id.into(), progress);
        let data = json!({ "id": id, "status": "applying", "progress": progress });
        self.core.emit("catalog.import.updated", &data, None);
    }

    /// Downloads and stores the photos; returns URL → file name and how many failed.
    async fn download(&self, id: &str, tree: &ImportTree) -> (HashMap<String, String>, i64) {
        let urls = sources(tree);
        let mut progress = ImportProgress {
            done: 0,
            total: urls.len() as i64,
        };
        self.report(id, progress);
        let mut fetches = futures::stream::iter(urls)
            .map(|url| async move {
                let fetched = self.images.fetch(&url).await;
                (url, fetched)
            })
            .buffer_unordered(PARALLEL);
        let (mut files, mut failed, mut reported) = (HashMap::new(), 0, Instant::now());
        while let Some((url, fetched)) = fetches.next().await {
            match fetched.and_then(|bytes| self.store_image("ifood", &bytes)) {
                Ok(file) => {
                    files.insert(url, file);
                }
                Err(_) => failed += 1,
            }
            progress.done += 1;
            if progress.done == progress.total || reported.elapsed() >= REPORT_EVERY {
                self.report(id, progress);
                reported = Instant::now();
            }
        }
        (files, failed)
    }

    async fn write_import(&self, actor: &Actor, id: &str, mode: &str, tree: &ImportTree) -> Result<()> {
        let (files, failed) = self.download(id, tree).await;
        let repo = &*self.core.repo;
        let now = self.core.now();
        self.core.commit(Some(actor), |_| {
            let mut current = self.import(actor, id)?;
            if current.status != "applying" {
                return fail_with(NOT_READY, 409);
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
            current.progress = None;
            repo.save_menu_import(&current)
        })
    }

    pub async fn apply_import(&self, actor: &Actor, id: &str, mode: &str) -> Result<MenuImport> {
        require_admin(actor)?;
        if !MODES.contains(&mode) {
            return fail("Modo inválido (use merge ou replace)");
        }
        let tree = self.claim(actor, id)?;
        // Its own task: leaving the page (which drops the request) must not stop it half-way.
        let (service, actor, id, mode) = (self.clone(), actor.clone(), id.to_string(), mode.to_string());
        tokio::spawn(async move { service.finish(&actor, &id, &mode, tree).await })
            .await
            .map_err(Error::internal)?
    }

    async fn finish(&self, actor: &Actor, id: &str, mode: &str, tree: ImportTree) -> Result<MenuImport> {
        let written = self.write_import(actor, id, mode, &tree).await;
        self.progress.lock().remove(id);
        self.running.lock().remove(id);
        if let Err(error) = written {
            // Nothing was written: the preview stays ready to be applied again.
            let _ = self.transition(id, |import| import.status = "ready".into());
            return Err(error);
        }
        self.changed(actor, "import", mode, None);
        self.transition(id, |_| {})
    }
}
