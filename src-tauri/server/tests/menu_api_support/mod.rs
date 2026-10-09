//! A burger shop built through the catalog API, shared by the catalog API tests.
#![allow(dead_code)]
use crate::common::{Agent, Fixture};
use serde_json::{json, Value};

/// A burger shop: "Lanches" with X-Burger (drink required, extras up to 3) and an agent login.
pub struct Shop {
    pub f: Fixture,
    pub admin: Agent,
    pub agent: Agent,
    pub category: i64,
    pub drinks: Value,
    pub extras: Value,
    pub burger: Value,
}

pub async fn shop() -> Shop {
    let f = Fixture::new().await;
    let admin = f.bootstrap().await;
    let agent = f.agent(&admin, "ana@example.com", "agent", false).await;
    let category = admin.post("/catalog/categories", json!({ "name": "Lanches" })).await;
    assert_eq!(category.status, 201, "{}", category.text);
    let drinks = admin
        .post(
            "/catalog/groups",
            json!({ "name": "Escolha a bebida", "type": "offer_unit", "options": [
                { "product": { "name": "Coca-Cola" }, "price_cents": 0, "external_code": "COCA" },
                { "product": { "name": "Guaraná" }, "price_cents": 0 }
            ] }),
        )
        .await;
    assert_eq!(drinks.status, 201, "{}", drinks.text);
    let extras = admin
        .post(
            "/catalog/groups",
            json!({ "name": "Adicionais", "options": [
                { "product": { "name": "Bacon" }, "price_cents": 400, "max_quantity": 2 },
                { "product": { "name": "Cheddar" }, "price_cents": 350 }
            ] }),
        )
        .await;
    let body = json!({
        "category_id": category.body["id"], "type": "default", "price_cents": 2990, "original_price_cents": 3490,
        "external_code": "XB01",
        "product": { "name": "X-Burger", "description": "Pão brioche e hambúrguer 150 g", "serving": "serves_1", "dietary": [] },
        "groups": [
            { "group_id": drinks.body["id"], "min": 1, "max": 1, "position": 0 },
            { "group_id": extras.body["id"], "min": 0, "max": 3, "position": 1 }
        ]
    });
    let burger = admin.post("/catalog/items", body).await;
    assert_eq!(burger.status, 201, "{}", burger.text);
    Shop {
        category: category.body["id"].as_i64().unwrap(),
        drinks: drinks.body,
        extras: extras.body,
        burger: burger.body,
        f,
        admin,
        agent,
    }
}
