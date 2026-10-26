//! Applying an iFood import: the photo download progress is announced, a second apply is refused
//! while the first runs, and an apply cut short by a restart leaves the preview ready again.
mod common;
mod menu_import_support;

use common::Fixture;
use menu_import_support::*;
use serde_json::{json, Value};
use wamcp_server::adapters::outbound::sqlite::SqliteStore;
use wamcp_server::application::ports::MenuImportRepo;
use wamcp_server::domain::menu::import::MenuImport;

#[tokio::test]
async fn applying_announces_photo_progress_and_refuses_a_second_apply() {
    let f = Fixture::new().await;
    let admin = f.bootstrap().await;
    let photo = "https://static-images.ifood.com.br/image/upload/t_high/pratos/202401/xburger.jpg";
    f.images.images.lock().insert(photo.into(), JPG.to_vec());
    f.crawler.set(script(vec![fixture("burger_legacy.json")]));
    let id = start(&admin).await;
    wait(&admin, &id, "ready").await;
    let path = format!("/catalog/imports/{id}/apply");
    let (first, second) = tokio::join!(
        admin.post(&path, json!({ "mode": "merge" })),
        admin.post(&path, json!({ "mode": "merge" }))
    );
    let mut codes = [first.status, second.status];
    codes.sort_unstable();
    assert_eq!(codes, [200, 409], "{} / {}", first.text, second.text);
    assert_eq!(f.images.requests.lock().len(), 2, "the photos are downloaded once");
    f.settle().await;
    let updates: Vec<Value> = f
        .events
        .lock()
        .iter()
        .filter(|e| e.event == "catalog.import.updated")
        .map(|e| e.data.clone())
        .collect();
    let statuses: Vec<&str> = updates.iter().filter_map(|u| u["status"].as_str()).collect();
    assert!(statuses.windows(2).any(|w| w == ["ready", "applying"]), "{statuses:?}");
    assert_eq!(statuses.last(), Some(&"applied"));
    let progress: Vec<&Value> = updates.iter().filter_map(|u| u.get("progress")).collect();
    assert_eq!(progress.first(), Some(&&json!({ "done": 0, "total": 2 })));
    assert_eq!(progress.last(), Some(&&json!({ "done": 2, "total": 2 })));
    let applied = admin.get(&format!("/catalog/imports/{id}")).await.body;
    assert_eq!(applied["status"], "applied");
    assert!(applied.get("progress").is_none(), "{applied}");
}

#[test]
fn an_apply_cut_short_by_a_restart_is_ready_again() {
    let store = SqliteStore::in_memory().expect("store");
    let import = |id: &str, status: &str| MenuImport {
        id: id.into(),
        url: STORE.into(),
        status: status.into(),
        ..MenuImport::default()
    };
    store.save_menu_import(&import("a", "applying")).unwrap();
    store.save_menu_import(&import("b", "loading")).unwrap();
    store.fail_stale_imports("A importação foi interrompida").unwrap();
    let status = |id: &str| store.menu_import(id).unwrap().unwrap().status;
    assert_eq!((status("a"), status("b")), ("ready".into(), "failed".into()));
}
