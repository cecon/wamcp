//! Catalog API: item validation, duplicate/reorder/status, groups, settings, events and audit.
mod common;
mod menu_api_support;

use menu_api_support::shop;
use serde_json::{json, Value};

#[tokio::test]
async fn items_validate_prices_codes_links_and_support_partial_updates() {
    let s = shop().await;
    let a = &s.admin;
    let path = format!("/catalog/items/{}", s.burger["id"]);
    let cheaper = a.patch(&path, json!({ "price_cents": 2490 })).await;
    assert_eq!(cheaper.status, 200, "{}", cheaper.text);
    assert_eq!(cheaper.body["groups"].as_array().map(Vec::len), Some(2), "links kept");
    assert_eq!(cheaper.body["original_price_cents"], 3490);
    let invalid = a.patch(&path, json!({ "original_price_cents": 100 })).await;
    assert_eq!(
        (invalid.status, invalid.body["error"].clone()),
        (422, json!("O preço original deve ser maior que o preço"))
    );
    let renamed = a
        .patch(
            &path,
            json!({ "product": { "name": "X-Bacon", "ean": "789" }, "original_price_cents": null }),
        )
        .await;
    assert_eq!(
        (
            renamed.body["product"]["name"].clone(),
            renamed.body["original_price_cents"].clone()
        ),
        (json!("X-Bacon"), Value::Null)
    );
    assert_eq!(renamed.body["product"]["description"], "Pão brioche e hambúrguer 150 g");
    let bounds = json!({ "groups": [{ "group_id": s.drinks["id"], "min": 2, "max": 1 }] });
    assert_eq!(a.patch(&path, bounds).await.status, 422);
    let twice = json!({ "groups": [{ "group_id": s.drinks["id"], "min": 1, "max": 1 }, { "group_id": s.drinks["id"], "min": 0, "max": 1 }] });
    assert_eq!(a.patch(&path, twice).await.status, 400);
    assert_eq!(
        a.patch(&path, json!({ "groups": [{ "group_id": 999, "min": 0, "max": 1 }] }))
            .await
            .status,
        422
    );
    assert_eq!(a.patch(&path, json!({ "type": "pizza" })).await.status, 422);
    let shifts = json!({ "shifts": [{ "days": [0, 6], "start": "18:00", "end": "02:00" }] });
    assert_eq!(a.patch(&path, shifts).await.body["shifts"][0]["end"], "02:00");
    assert_eq!(
        a.patch(
            &path,
            json!({ "shifts": [{ "days": [9], "start": "18:00", "end": "02:00" }] })
        )
        .await
        .status,
        400
    );
    let no_category = a.post("/catalog/items", json!({ "product": { "name": "Y" } })).await;
    assert_eq!(no_category.status, 400);
    let nameless = a
        .post(
            "/catalog/items",
            json!({ "category_id": s.category, "product": { "name": " " } }),
        )
        .await;
    assert_eq!(nameless.status, 400);
    let same_code = a
        .post(
            "/catalog/items",
            json!({ "category_id": s.category, "external_code": "XB01", "product": { "name": "Y" } }),
        )
        .await;
    assert_eq!(same_code.status, 409);
    let wrong_type = a
        .post(
            "/catalog/items",
            json!({ "category_id": s.category, "type": "combo", "product": { "name": "Y" } }),
        )
        .await;
    assert_eq!(wrong_type.status, 422);
    assert_eq!(
        a.post(
            "/catalog/items",
            json!({ "category_id": 999, "product": { "name": "Y" } })
        )
        .await
        .status,
        404
    );
}

#[tokio::test]
async fn items_duplicate_reorder_pause_and_delete() {
    let s = shop().await;
    let a = &s.admin;
    let id = s.burger["id"].as_i64().unwrap();
    let copy = a.post(&format!("/catalog/items/{id}/duplicate"), json!({})).await;
    assert_eq!(copy.status, 201, "{}", copy.text);
    assert_eq!(copy.body["product"]["name"], "X-Burger (cópia)");
    assert_eq!(
        (copy.body["external_code"].clone(), copy.body["position"].clone()),
        (Value::Null, json!(1))
    );
    assert_eq!(copy.body["groups"].as_array().map(Vec::len), Some(2));
    let copy_id = copy.body["id"].as_i64().unwrap();
    let order = a
        .post(
            "/catalog/items/reorder",
            json!({ "category_id": s.category, "ids": [copy_id, id] }),
        )
        .await;
    assert_eq!(order.body[0]["id"], copy_id);
    assert_eq!(
        a.post(
            "/catalog/items/reorder",
            json!({ "category_id": s.category, "ids": [id] })
        )
        .await
        .status,
        400
    );
    let paused = a
        .post(
            "/catalog/items/status",
            json!({ "ids": [id, copy_id], "status": "unavailable" }),
        )
        .await;
    assert!(paused
        .body
        .as_array()
        .unwrap()
        .iter()
        .all(|i| i["available_now"] == false));
    assert_eq!(
        a.post("/catalog/items/status", json!({ "ids": [id], "status": "off" }))
            .await
            .status,
        400
    );
    assert_eq!(
        a.post("/catalog/items/status", json!({ "ids": [4242], "status": "available" }))
            .await
            .status,
        404
    );
    assert_eq!(
        s.agent
            .get("/catalog/search?q=burger")
            .await
            .body
            .as_array()
            .map(Vec::len),
        Some(2)
    );
    assert_eq!(a.del(&format!("/catalog/items/{copy_id}"), None).await.status, 200);
    assert_eq!(a.del(&format!("/catalog/items/{copy_id}"), None).await.status, 404);
    s.f.settle().await;
    let names = s.f.event_names();
    assert!(
        names.iter().filter(|n| *n == "catalog.updated").count() >= 6,
        "{names:?}"
    );
    let audit = a.get("/audit_logs").await.body.to_string();
    for action in ["\"duplicate\"", "\"catalog_item\"", "\"reorder\"", "\"status\""] {
        assert!(audit.contains(action), "{action} in {audit}");
    }
}

#[tokio::test]
async fn groups_replace_options_and_cannot_be_deleted_while_used() {
    let s = shop().await;
    let a = &s.admin;
    let path = format!("/catalog/groups/{}", s.extras["id"]);
    let bacon = s.extras["options"][0]["id"].clone();
    let replaced = a
        .patch(
            &path,
            json!({ "options": [
            { "product": { "name": "Ovo" }, "price_cents": 250 },
            { "id": bacon, "price_cents": 450, "position": 5 }
        ] }),
        )
        .await;
    assert_eq!(replaced.status, 200, "{}", replaced.text);
    let options: Vec<(String, i64)> = replaced.body["options"]
        .as_array()
        .unwrap()
        .iter()
        .map(|o| {
            (
                o["product"]["name"].as_str().unwrap().into(),
                o["price_cents"].as_i64().unwrap(),
            )
        })
        .collect();
    assert_eq!(options, [("Ovo".to_string(), 250), ("Bacon".to_string(), 450)]);
    assert_eq!(replaced.body["options"][1]["id"], bacon, "kept option keeps its id");
    let renamed = a
        .patch(&path, json!({ "name": "Extras", "status": "unavailable" }))
        .await;
    assert_eq!(
        renamed.body["options"].as_array().map(Vec::len),
        Some(2),
        "options untouched without the key"
    );
    let foreign = a
        .patch(&path, json!({ "options": [{ "id": s.drinks["options"][0]["id"] }] }))
        .await;
    assert_eq!(foreign.status, 422);
    let fraction = a
        .patch(
            &path,
            json!({ "options": [{ "product": { "name": "X" }, "fractions": [1] }] }),
        )
        .await;
    assert_eq!(fraction.status, 422);
    let shared = a
        .post(
            "/catalog/groups",
            json!({ "name": "Molhos", "options": [{ "product_id": 99999 }] }),
        )
        .await;
    assert_eq!(shared.status, 422);
    assert_eq!(
        a.post("/catalog/groups", json!({ "name": "G", "type": "x" }))
            .await
            .status,
        400
    );
    let used = a.del(&path, None).await;
    assert_eq!(
        (used.status, used.body["error"].clone()),
        (409, json!("O grupo está em uso por itens do cardápio"))
    );
    let free = a
        .post(
            "/catalog/groups",
            json!({ "name": "Talheres", "type": "cutlery", "external_code": "TAL" }),
        )
        .await;
    assert_eq!(
        a.post("/catalog/groups", json!({ "name": "T2", "external_code": "TAL" }))
            .await
            .status,
        409
    );
    assert_eq!(
        a.del(&format!("/catalog/groups/{}", free.body["id"]), None)
            .await
            .status,
        200
    );
    assert_eq!(a.get(&format!("/catalog/groups/{}", free.body["id"])).await.status, 404);
}

#[tokio::test]
async fn settings_are_read_by_agents_and_saved_by_administrators() {
    let s = shop().await;
    let current = s.agent.get("/catalog/settings").await.body;
    assert_eq!(
        current,
        json!({ "pizza_pricing": "greater", "notes_max_length": 140, "timezone": "America/Sao_Paulo" })
    );
    let saved = s
        .admin
        .patch(
            "/catalog/settings",
            json!({ "pizza_pricing": "average", "notes_max_length": 200 }),
        )
        .await;
    assert_eq!(saved.body["pizza_pricing"], "average");
    assert_eq!(s.agent.get("/catalog").await.body["settings"]["notes_max_length"], 200);
    assert_eq!(
        s.admin
            .patch("/catalog/settings", json!({ "timezone": "Lua/Base" }))
            .await
            .status,
        400
    );
    assert_eq!(
        s.admin
            .patch("/catalog/settings", json!({ "pizza_pricing": "cheapest" }))
            .await
            .status,
        400
    );
}
