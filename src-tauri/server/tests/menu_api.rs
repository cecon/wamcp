//! Catalog API: item shape, search, permissions and categories.
mod common;
mod menu_api_support;

use menu_api_support::shop;
use serde_json::{json, Value};

#[tokio::test]
async fn items_have_the_same_full_shape_everywhere() {
    let s = shop().await;
    let id = s.burger["id"].as_i64().unwrap();
    assert_eq!(s.burger["type"], "default");
    assert_eq!(s.burger["product"]["name"], "X-Burger");
    assert_eq!(s.burger["product"]["image_url"], Value::Null);
    assert!(s.burger["product"].get("image").is_none());
    assert_eq!(s.burger["available_now"], true);
    assert_eq!(s.burger["groups"][0]["group"]["name"], "Escolha a bebida");
    assert_eq!(
        s.burger["groups"][0]["group"]["options"][0]["product"]["name"],
        "Coca-Cola"
    );
    assert_eq!(s.burger["groups"][0]["group"]["used_by"], 1);
    assert_eq!(s.burger["groups"][1]["max"], 3);
    let shown = s.agent.get(&format!("/catalog/items/{id}")).await;
    assert_eq!(shown.body, s.burger);
    let menu = s.agent.get("/catalog").await;
    assert_eq!(menu.body["settings"]["pizza_pricing"], "greater");
    assert_eq!(menu.body["categories"][0]["items"][0], s.burger);
    assert_eq!(menu.body["categories"][0]["items_count"], 1);
    let found = s.agent.get("/catalog/search?q=burg").await;
    assert_eq!(found.body, json!([s.burger.clone()]));
    assert_eq!(s.agent.get("/catalog/search?q=XB01").await.body[0]["id"], id);
    assert_eq!(s.agent.get("/catalog/search?q=").await.status, 400);
    let listed = s
        .agent
        .get(&format!(
            "/catalog/items?category_id={}&q=hamburguer&status=available",
            s.category
        ))
        .await;
    assert_eq!(listed.body.as_array().map(Vec::len), Some(1));
    assert_eq!(s.agent.get("/catalog/items?status=unavailable").await.body, json!([]));
    assert_eq!(s.agent.get("/catalog/items?status=paused").await.status, 400);
    assert_eq!(s.agent.get("/catalog/items/999").await.status, 404);
    let groups = s.agent.get("/catalog/groups").await.body;
    assert_eq!(groups.as_array().map(Vec::len), Some(2));
    let group = s.agent.get(&format!("/catalog/groups/{}", s.drinks["id"])).await;
    assert_eq!(group.body["options"][0]["external_code"], "COCA");
    assert!(group.body["options"][0]["id"].as_i64().is_some());
}

#[tokio::test]
async fn agents_read_but_only_administrators_write() {
    let s = shop().await;
    let id = s.burger["id"].as_i64().unwrap();
    let denied = [
        s.agent.post("/catalog/categories", json!({ "name": "X" })).await,
        s.agent
            .patch(&format!("/catalog/items/{id}"), json!({ "price_cents": 1 }))
            .await,
        s.agent.del(&format!("/catalog/items/{id}"), None).await,
        s.agent.post("/catalog/groups", json!({ "name": "G" })).await,
        s.agent
            .patch("/catalog/settings", json!({ "pizza_pricing": "average" }))
            .await,
        s.agent
            .post(
                "/catalog/imports",
                json!({ "url": "https://www.ifood.com.br/delivery/a/b/c" }),
            )
            .await,
    ];
    for reply in denied {
        assert_eq!(reply.status, 403, "{}", reply.text);
        assert_eq!(reply.body["error"], "Somente administradores podem fazer isso");
    }
    assert_eq!(s.agent.get("/catalog/categories").await.status, 200);
    let anonymous = s.f.api("GET", "/catalog", None, &[]).await;
    assert_eq!(anonymous.status, 401);
}

#[tokio::test]
async fn categories_are_unique_single_pizza_reorderable_and_deleted_only_when_empty() {
    let s = shop().await;
    let a = &s.admin;
    assert_eq!(
        a.post("/catalog/categories", json!({ "name": "lanches" })).await.status,
        409
    );
    assert_eq!(a.post("/catalog/categories", json!({ "name": "" })).await.status, 400);
    assert_eq!(
        a.post("/catalog/categories", json!({ "name": "X", "template": "sushi" }))
            .await
            .status,
        400
    );
    assert_eq!(a.post("/catalog/categories", json!({ "name": 5 })).await.status, 400);
    let pizzas = a
        .post(
            "/catalog/categories",
            json!({ "name": "Pizzas", "template": "pizza", "external_code": "PZ" }),
        )
        .await;
    assert_eq!((pizzas.status, pizzas.body["position"].clone()), (201, json!(1)));
    let second = a
        .post("/catalog/categories", json!({ "name": "Doces", "template": "pizza" }))
        .await;
    assert_eq!(
        (second.status, second.body["error"].clone()),
        (422, json!("Já existe uma categoria de pizza"))
    );
    let code = a
        .post("/catalog/categories", json!({ "name": "Doces", "external_code": "PZ" }))
        .await;
    assert_eq!(code.status, 409);
    let drinks = a
        .post(
            "/catalog/categories",
            json!({ "name": "Bebidas", "description": "Geladas" }),
        )
        .await
        .body;
    let order = json!({ "ids": [drinks["id"], pizzas.body["id"], s.category] });
    let reordered = a.post("/catalog/categories/reorder", order).await;
    let names: Vec<&str> = reordered
        .body
        .as_array()
        .unwrap()
        .iter()
        .map(|c| c["name"].as_str().unwrap())
        .collect();
    assert_eq!(names, ["Bebidas", "Pizzas", "Lanches"]);
    assert_eq!(
        a.post("/catalog/categories/reorder", json!({ "ids": [s.category] }))
            .await
            .status,
        400
    );
    let lanches = format!("/catalog/categories/{}", s.category);
    let template = a.patch(&lanches, json!({ "template": "combo" })).await;
    assert_eq!(template.status, 422, "items keep the template of their category");
    let paused = a
        .patch(&lanches, json!({ "status": "unavailable", "description": null }))
        .await;
    assert_eq!(
        (paused.body["status"].clone(), paused.body["items_count"].clone()),
        (json!("unavailable"), json!(1))
    );
    let available = s.agent.get("/catalog?available=true").await.body;
    let shown: Vec<&str> = available["categories"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| c["name"].as_str().unwrap())
        .collect();
    assert!(shown.is_empty(), "a paused category hides its items: {shown:?}");
    assert_eq!(
        s.agent.get(&format!("/catalog/items/{}", s.burger["id"])).await.body["available_now"],
        false
    );
    let blocked = a.del(&lanches, None).await;
    assert_eq!(
        (blocked.status, blocked.body["error"].clone()),
        (409, json!("A categoria precisa estar vazia para ser apagada"))
    );
    assert_eq!(
        a.del(&format!("/catalog/categories/{}", drinks["id"]), None)
            .await
            .status,
        200
    );
    assert_eq!(
        a.patch("/catalog/categories/999", json!({ "name": "x" })).await.status,
        404
    );
}
