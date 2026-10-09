//! Catalog API: pizza (size → crust → edge → topping with per-size prices, as the UI saves it),
//! combo, quote over HTTP and product photos.
mod common;

use common::http::{multipart, send_multipart};
use common::{Agent, Fixture};
use serde_json::{json, Value};

const PNG: &[u8] = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR";

async fn group(admin: &Agent, body: Value) -> Value {
    let reply = admin.post("/catalog/groups", body).await;
    assert_eq!(reply.status, 201, "{}", reply.text);
    reply.body
}

fn ids(group: &Value) -> Vec<i64> {
    group["options"]
        .as_array()
        .unwrap()
        .iter()
        .map(|o| o["id"].as_i64().unwrap())
        .collect()
}

struct Pizzeria {
    f: Fixture,
    admin: Agent,
    pizza: Value,
    sizes: Vec<i64>,
    crust: Vec<i64>,
    toppings: Vec<i64>,
    size_group: i64,
}

async fn pizzeria() -> Pizzeria {
    let f = Fixture::new().await;
    let admin = f.bootstrap().await;
    let category = admin
        .post("/catalog/categories", json!({ "name": "Pizzas", "template": "pizza" }))
        .await
        .body;
    let size = group(
        &admin,
        json!({ "name": "Tamanho", "type": "size", "options": [
        { "product": { "name": "Broto", "slices": 4 }, "price_cents": 0, "fractions": [1], "position": 0 },
        { "product": { "name": "Grande", "slices": 8 }, "price_cents": 500, "fractions": [1, 2], "position": 1 }
    ] }),
    )
    .await;
    let sizes = ids(&size);
    let crust = group(&admin, json!({ "name": "Massa", "type": "crust", "options": [{ "product": { "name": "Tradicional" }, "price_cents": 0 }] })).await;
    let edge = group(&admin, json!({ "name": "Borda", "type": "edge", "options": [{ "product": { "name": "Catupiry" }, "price_cents": 800 }] })).await;
    let topping = group(&admin, json!({ "name": "Sabores", "type": "topping", "options": [
        { "product": { "name": "Calabresa" }, "price_cents": 3000, "external_code": "SAB-CAL",
          "size_prices": [{ "size_option_id": sizes[0], "price_cents": 3000 }, { "size_option_id": sizes[1], "price_cents": 5000 }] },
        { "product": { "name": "Portuguesa" }, "price_cents": 3500,
          "size_prices": [{ "size_option_id": sizes[0], "price_cents": 3500 }, { "size_option_id": sizes[1], "price_cents": 5890 }] }
    ] }))
    .await;
    assert_eq!(
        topping["options"][0]["size_prices"][1],
        json!({ "size_option_id": sizes[1], "price_cents": 5000 })
    );
    let links = json!([
        { "group_id": size["id"], "min": 1, "max": 1, "position": 0 },
        { "group_id": crust["id"], "min": 1, "max": 1, "position": 1 },
        { "group_id": edge["id"], "min": 0, "max": 1, "position": 2 },
        { "group_id": topping["id"], "min": 1, "max": 2, "position": 3 }
    ]);
    let body = json!({ "category_id": category["id"], "type": "pizza", "price_cents": 0, "product": { "name": "Pizza" }, "groups": links });
    let pizza = admin.post("/catalog/items", body).await;
    assert_eq!(pizza.status, 201, "{}", pizza.text);
    Pizzeria {
        sizes,
        crust: ids(&crust),
        toppings: ids(&topping),
        size_group: size["id"].as_i64().unwrap(),
        pizza: pizza.body,
        f,
        admin,
    }
}

#[tokio::test]
async fn pizzas_are_built_like_the_ui_and_quoted_by_the_store_rule() {
    let p = pizzeria().await;
    assert_eq!(p.pizza["type"], "pizza");
    let choices = json!([
        { "option_id": p.sizes[1] }, { "option_id": p.crust[0] },
        { "option_id": p.toppings[0] }, { "option_id": p.toppings[1] }
    ]);
    let body = json!({ "item_id": p.pizza["id"], "quantity": 2, "notes": "bem passada", "choices": choices });
    let greater = p.admin.post("/catalog/quote", body.clone()).await.body;
    assert_eq!(greater["errors"], json!([]));
    assert_eq!(
        (
            greater["unit_price_cents"].clone(),
            greater["total_price_cents"].clone()
        ),
        (json!(6390), json!(12780))
    );
    assert_eq!(greater["lines"][3]["name"], "1/2 Calabresa");
    assert_eq!(greater["lines"][3]["external_code"], "SAB-CAL");
    p.admin
        .patch("/catalog/settings", json!({ "pizza_pricing": "average" }))
        .await;
    let average = p.admin.post("/catalog/quote", body).await.body;
    assert_eq!(average["unit_price_cents"], 500 + 5445);
    let broto = json!({ "item_id": p.pizza["id"], "choices": [
        { "option_id": p.sizes[0] }, { "option_id": p.crust[0] }, { "option_id": p.toppings[0] }, { "option_id": p.toppings[1] }
    ] });
    let errors = p.admin.post("/catalog/quote", broto).await.body["errors"].clone();
    assert_eq!(errors, json!(["O tamanho ‘Broto’ não aceita 2 sabores"]));
    assert_eq!(
        p.admin.post("/catalog/quote", json!({ "item_id": 999 })).await.status,
        404
    );
    assert_eq!(
        p.admin.post("/catalog/quote", json!({ "item_id": "x" })).await.status,
        400
    );
}

#[tokio::test]
async fn pizza_structure_is_enforced_on_items_and_on_shared_groups() {
    let p = pizzeria().await;
    let a = &p.admin;
    let path = format!("/catalog/items/{}", p.pizza["id"]);
    let groups = p.pizza["groups"].as_array().unwrap().clone();
    let link = |i: usize, min: i64, max: i64| json!({ "group_id": groups[i]["group_id"], "min": min, "max": max });
    let cases = [
        (
            vec![link(1, 1, 1), link(3, 1, 2)],
            "A pizza precisa de um grupo de tamanho",
        ),
        (
            vec![link(0, 0, 1), link(3, 1, 2)],
            "O tamanho da pizza deve ter mínimo 1 e máximo 1",
        ),
        (vec![link(0, 1, 1)], "A pizza precisa de um grupo de sabores"),
        (
            vec![link(0, 1, 1), link(3, 1, 1)],
            "Os sabores devem ter mínimo 1 e máximo 2 (maior fração dos tamanhos)",
        ),
        (
            vec![link(0, 1, 1), link(1, 0, 1), link(3, 1, 2)],
            "A massa da pizza deve ter mínimo 1 e máximo 1",
        ),
        (
            vec![link(0, 1, 1), link(2, 1, 1), link(3, 1, 2)],
            "A borda da pizza deve ter mínimo 0 e máximo 1",
        ),
    ];
    for (links, error) in cases {
        let reply = a.patch(&path, json!({ "groups": links })).await;
        assert_eq!(
            (reply.status, reply.body["error"].as_str().unwrap_or_default()),
            (422, error)
        );
    }
    assert_eq!(a.patch(&path, json!({ "price_cents": 100 })).await.status, 422);
    // Dropping the 2-flavour size would break the pizza linking this group: refused atomically.
    let size_path = format!("/catalog/groups/{}", p.size_group);
    let shrink = json!({ "options": [{ "id": p.sizes[0], "fractions": [1] }, { "id": p.sizes[1], "fractions": [1] }] });
    let refused = a.patch(&size_path, shrink).await;
    assert_eq!(refused.status, 422, "{}", refused.text);
    assert!(refused.body["error"]
        .as_str()
        .unwrap()
        .starts_with("‘Pizza’ ficaria inválido"));
    assert_eq!(a.get(&size_path).await.body["options"][1]["fractions"], json!([1, 2]));
    let bad_size = json!({ "name": "Sabores 2", "type": "topping", "options": [{ "product": { "name": "X" }, "size_prices": [{ "size_option_id": p.crust[0], "price_cents": 1 }] }] });
    assert_eq!(a.post("/catalog/groups", bad_size).await.status, 422);
    let no_fraction = json!({ "name": "T2", "type": "size", "options": [{ "product": { "name": "Média" } }] });
    assert_eq!(a.post("/catalog/groups", no_fraction).await.status, 422);
}

#[tokio::test]
async fn combos_point_at_menu_items_and_quote_their_complements() {
    let p = pizzeria().await;
    let a = &p.admin;
    let snacks = a.post("/catalog/categories", json!({ "name": "Lanches" })).await.body;
    let burger = a
        .post(
            "/catalog/items",
            json!({ "category_id": snacks["id"], "price_cents": 2990, "product": { "name": "X-Burger" } }),
        )
        .await
        .body;
    let combos = a
        .post("/catalog/categories", json!({ "name": "Combos", "template": "combo" }))
        .await
        .body;
    let main = group(
        a,
        json!({ "name": "Escolha o item principal", "type": "combo_main", "options": [
        { "product": { "name": "X-Burger" }, "price_cents": 0, "item_id": burger["id"] },
        { "product": { "name": "Pizza" }, "price_cents": 1000, "item_id": p.pizza["id"] }
    ] }),
    )
    .await;
    let no_main = a
        .post(
            "/catalog/items",
            json!({ "category_id": combos["id"], "price_cents": 3990, "product": { "name": "Combo" } }),
        )
        .await;
    assert_eq!(no_main.status, 422);
    let links = json!([{ "group_id": main["id"], "min": 1, "max": 1 }]);
    let combo = a.post("/catalog/items", json!({ "category_id": combos["id"], "price_cents": 3990, "product": { "name": "Combo" }, "groups": links })).await;
    assert_eq!(combo.status, 201, "{}", combo.text);
    let choices = json!([{ "option_id": main["options"][1]["id"], "choices": [
        { "option_id": p.sizes[0] }, { "option_id": p.crust[0] }, { "option_id": p.toppings[1] }
    ] }]);
    let quote = a
        .post(
            "/catalog/quote",
            json!({ "item_id": combo.body["id"], "choices": choices }),
        )
        .await
        .body;
    assert_eq!(quote["errors"], json!([]), "{quote}");
    assert_eq!(quote["unit_price_cents"], 3990 + 1000 + 3500);
    let nested_combo = json!({ "name": "G", "type": "combo_main", "options": [{ "product": { "name": "C" }, "item_id": combo.body["id"] }] });
    assert_eq!(a.post("/catalog/groups", nested_combo).await.status, 422);
    let missing =
        json!({ "name": "G", "type": "combo_main", "options": [{ "product": { "name": "C" }, "item_id": 9999 }] });
    assert_eq!(a.post("/catalog/groups", missing).await.status, 422);
    let not_combo = json!({ "name": "G", "options": [{ "product": { "name": "C" }, "item_id": burger["id"] }] });
    assert_eq!(a.post("/catalog/groups", not_combo).await.status, 422);
}

#[tokio::test]
async fn product_photos_are_uploaded_served_and_removed() {
    let p = pizzeria().await;
    let agent = p.f.agent(&p.admin, "ana@example.com", "agent", false).await;
    // Options have products too; find the topping's product through the group.
    let groups = p.admin.get("/catalog/groups").await.body;
    let topping = groups
        .as_array()
        .unwrap()
        .iter()
        .find(|g| g["type"] == "topping")
        .unwrap()
        .clone();
    let product_id = topping["options"][0]["product"]["id"].as_i64().unwrap();
    let path = format!("/catalog/products/{product_id}/image");
    let denied = send_multipart(&agent, &path, multipart(&[], &[("image", "a.png", "image/png", PNG)])).await;
    assert_eq!(denied.status, 403);
    let fake = send_multipart(
        &p.admin,
        &path,
        multipart(&[], &[("image", "a.png", "image/png", b"<svg/>")]),
    )
    .await;
    assert_eq!(
        (fake.status, fake.body["error"].clone()),
        (400, json!("Envie uma imagem PNG, JPG ou WebP"))
    );
    let empty = send_multipart(&p.admin, &path, multipart(&[("other", "x")], &[])).await;
    assert_eq!(empty.status, 400);
    let uploaded = send_multipart(&p.admin, &path, multipart(&[], &[("image", "a.png", "image/png", PNG)])).await;
    assert_eq!(uploaded.status, 200, "{}", uploaded.text);
    let url = uploaded.body["image_url"].as_str().unwrap().to_string();
    assert!(
        url.starts_with("/api/v1/catalog/images/p") && url.ends_with(".png"),
        "{url}"
    );
    let file = url.trim_start_matches("/api/v1");
    let served = agent.get(file).await;
    assert_eq!(
        (served.status, served.header("content-type").as_deref()),
        (200, Some("image/png"))
    );
    assert_eq!(served.header("content-length"), Some(PNG.len().to_string()));
    assert_eq!(p.f.api("GET", file, None, &[]).await.status, 401);
    assert!(p.f.storage.files.lock().keys().any(|k| k.starts_with("catalog/p")));
    let shown = p.admin.get(&format!("/catalog/groups/{}", topping["id"])).await;
    assert_eq!(shown.body["options"][0]["product"]["image_url"], url);
    let removed = p.admin.del(&path, None).await;
    assert_eq!(removed.body["image_url"], Value::Null);
    assert_eq!(agent.get("/catalog/images/..%2Fwamcp.sqlite").await.status, 404);
    assert_eq!(agent.get("/catalog/images/nothing.png").await.status, 404);
    let missing = send_multipart(
        &p.admin,
        "/catalog/products/9999/image",
        multipart(&[], &[("image", "a.png", "image/png", PNG)]),
    )
    .await;
    assert_eq!(missing.status, 404);
}
