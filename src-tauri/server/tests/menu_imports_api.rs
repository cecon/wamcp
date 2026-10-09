//! iFood import over HTTP with the scripted crawler: start → ready with preview → apply
//! merge/replace, photos, cancel, waiting for a human, failures, timeout and validation.
mod common;
mod menu_import_support;

use common::Fixture;
use menu_import_support::*;
use serde_json::{json, Value};
use std::time::Duration;
use wamcp_server::adapters::outbound::crawler::memory::Script;
use wamcp_server::application::ports::CrawlStatus;

#[tokio::test]
async fn an_import_is_previewed_then_merged_with_photos() {
    let f = Fixture::new().await;
    let admin = f.bootstrap().await;
    let photo = "https://static-images.ifood.com.br/image/upload/t_high/pratos/202401/xburger.jpg";
    f.images.images.lock().insert(photo.into(), JPG.to_vec());
    f.crawler.set(script(vec![fixture("burger_legacy.json")]));
    let id = start(&admin).await;
    let ready = wait(&admin, &id, "ready").await;
    assert_eq!(ready["url"], STORE);
    assert_eq!(ready["message"], Value::Null);
    assert_eq!(
        ready["counts"],
        json!({ "categories": 2, "items": 3, "groups": 2, "options": 5, "images": 2, "images_failed": 0 })
    );
    assert_eq!(
        ready["preview"]["categories"][0]["items"][0]["groups"][0]["type"],
        "offer_unit"
    );
    assert!(ready.get("payload").is_none(), "captured JSON stays private");
    assert_eq!(f.crawler.urls.lock().clone(), vec![STORE.to_string()]);
    assert!(f.crawler.complete.load(std::sync::atomic::Ordering::SeqCst));
    let applied = admin
        .post(&format!("/catalog/imports/{id}/apply"), json!({ "mode": "merge" }))
        .await
        .body;
    assert_eq!(
        (applied["status"].clone(), applied["counts"]["images_failed"].clone()),
        (json!("applied"), json!(1))
    );
    assert!(applied["finished_at"].is_number());
    let menu = admin.get("/catalog").await.body;
    assert_eq!(names(&menu), ["X-Burger", "X-Salada", "Suco de laranja 500 ml"]);
    let burger = &menu["categories"][0]["items"][0];
    assert_eq!(
        (burger["price_cents"].clone(), burger["original_price_cents"].clone()),
        (json!(2990), json!(3490))
    );
    assert_eq!(
        (burger["ifood_id"].clone(), burger["external_code"].clone()),
        (json!("it-xburger"), json!("XB01"))
    );
    assert!(burger["product"]["image_url"]
        .as_str()
        .unwrap()
        .starts_with("/api/v1/catalog/images/ifood-"));
    assert_eq!(burger["groups"][0]["min"], 1);
    let drinks = burger["groups"][0]["group_id"].clone();
    assert_eq!(
        menu["categories"][0]["items"][1]["groups"][0]["group_id"], drinks,
        "shared group"
    );
    assert_eq!(
        admin.get("/catalog/groups").await.body.as_array().map(Vec::len),
        Some(2)
    );
    assert_eq!(f.images.requests.lock().len(), 2);
    let again = admin
        .post(&format!("/catalog/imports/{id}/apply"), json!({ "mode": "merge" }))
        .await;
    assert_eq!(again.status, 409);
    f.settle().await;
    assert!(f.event_names().iter().any(|n| n == "catalog.import.updated"));
    let audit = admin.get("/audit_logs").await.body.to_string();
    assert!(audit.contains("catalog_import"), "{audit}");
}

#[tokio::test]
async fn merge_updates_matches_keeps_local_items_and_replace_starts_over() {
    let f = Fixture::new().await;
    let admin = f.bootstrap().await;
    imported(&f, &admin, "burger_legacy.json", "merge").await;
    let before = admin.get("/catalog").await.body;
    let burger_id = before["categories"][0]["items"][0]["id"].clone();
    let local = admin
        .post("/catalog/items", json!({ "category_id": before["categories"][0]["id"], "price_cents": 1500, "product": { "name": "Batata frita" } }))
        .await;
    assert_eq!(local.status, 201);
    let mut changed = fixture("burger_legacy.json");
    changed["data"]["menu"][0]["itens"][0]["unitPrice"] = json!(31.5);
    changed["data"]["menu"][0]["itens"][0]["choices"][1]["garnishItens"]
        .as_array_mut()
        .unwrap()
        .pop();
    f.crawler.set(script(vec![changed]));
    let id = start(&admin).await;
    wait(&admin, &id, "ready").await;
    admin
        .post(&format!("/catalog/imports/{id}/apply"), json!({ "mode": "merge" }))
        .await;
    let after = admin.get("/catalog").await.body;
    let burger = &after["categories"][0]["items"][0];
    assert_eq!(
        (burger["id"].clone(), burger["price_cents"].clone()),
        (burger_id, json!(3150))
    );
    assert_eq!(
        burger["groups"][1]["group"]["options"].as_array().map(Vec::len),
        Some(2)
    );
    assert!(
        names(&after).contains(&"Batata frita".to_string()),
        "local-only items are kept"
    );
    assert_eq!(after["categories"].as_array().map(Vec::len), Some(2));

    imported(&f, &admin, "pizzaria_v2.json", "merge").await;
    let merged = admin.get("/catalog").await.body;
    let categories: Vec<&str> = merged["categories"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| c["name"].as_str().unwrap())
        .collect();
    assert_eq!(categories, ["Lanches", "Bebidas", "Pizzas"]);
    let pizza = merged["categories"][2]["items"][0]["id"].clone();
    let sizes = &merged["categories"][2]["items"][0]["groups"][0]["group"]["options"];
    let toppings = &merged["categories"][2]["items"][0]["groups"][3]["group"]["options"];
    assert_eq!(toppings[2]["size_prices"][1]["size_option_id"], sizes[1]["id"]);
    let choices = json!([{ "option_id": sizes[1]["id"] }, { "option_id": merged["categories"][2]["items"][0]["groups"][1]["group"]["options"][0]["id"] },
        { "option_id": toppings[0]["id"] }, { "option_id": toppings[2]["id"] }]);
    let quote = admin
        .post("/catalog/quote", json!({ "item_id": pizza, "choices": choices }))
        .await
        .body;
    assert_eq!(
        (quote["errors"].clone(), quote["unit_price_cents"].clone()),
        (json!([]), json!(5890))
    );

    admin
        .patch("/catalog/settings", json!({ "pizza_pricing": "average" }))
        .await;
    imported(&f, &admin, "acai_v2.json", "replace").await;
    let replaced = admin.get("/catalog").await.body;
    assert_eq!(names(&replaced), ["Açaí 500 ml", "Açaí 300 ml"]);
    assert_eq!(replaced["settings"]["pizza_pricing"], "greater");
    assert_eq!(
        admin.get("/catalog/groups").await.body.as_array().map(Vec::len),
        Some(1)
    );
    let acai = &replaced["categories"][0]["items"][0];
    assert_eq!(
        (acai["external_code"].clone(), acai["product"]["external_code"].clone()),
        (json!("AC500"), json!("P-AC500"))
    );
    assert_eq!(acai["shifts"][0]["days"], json!([1, 2, 3, 4, 5, 6]));
}

#[tokio::test]
async fn waiting_for_a_human_is_reported_and_cancelling_closes_the_browser() {
    let f = Fixture::new().await;
    let admin = f.bootstrap().await;
    f.crawler.set(Script {
        statuses: vec![CrawlStatus::Opening, CrawlStatus::WaitingHuman],
        hold: true,
        ..Script::default()
    });
    let id = start(&admin).await;
    let waiting = wait(&admin, &id, "waiting_human").await;
    assert_eq!(waiting["message"], "Confirme no navegador que você é humano");
    let busy = admin.post("/catalog/imports", json!({ "url": STORE })).await;
    assert_eq!(
        (busy.status, busy.body["error"].clone()),
        (409, json!("Já existe uma importação em andamento"))
    );
    let cancelled = admin.del(&format!("/catalog/imports/{id}"), None).await;
    assert_eq!(cancelled.body["status"], "cancelled");
    for _ in 0..200 {
        if f.crawler.closed_by_cancel.load(std::sync::atomic::Ordering::SeqCst) {
            break;
        }
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
    assert!(f.crawler.closed_by_cancel.load(std::sync::atomic::Ordering::SeqCst));
    tokio::time::sleep(Duration::from_millis(20)).await;
    assert_eq!(
        admin.get(&format!("/catalog/imports/{id}")).await.body["status"],
        "cancelled"
    );
    assert_eq!(admin.del(&format!("/catalog/imports/{id}"), None).await.status, 200);
    let apply = admin
        .post(&format!("/catalog/imports/{id}/apply"), json!({ "mode": "merge" }))
        .await;
    assert_eq!(apply.status, 409);
    f.crawler.set(script(vec![fixture("acai_v2.json")]));
    let next = start(&admin).await;
    wait(&admin, &next, "ready").await;
    assert_eq!(
        admin.del(&format!("/catalog/imports/{next}"), None).await.body["status"],
        "cancelled",
        "a preview can be discarded"
    );
}
