//! Saved views (custom filters) per agent.
mod common;

use common::filters::{condition, setup};
use common::Fixture;
use serde_json::json;

#[tokio::test]
async fn saved_views_belong_to_their_agent() {
    let f = Fixture::new().await;
    let admin = setup(&f).await;
    let maria = f.agent(&admin, "maria@example.com", "agent", true).await;
    let query = json!({ "payload": [condition("priority", "equal_to", json!(["urgent"]), "and")] });
    let view = maria
        .post(
            "/custom_filters",
            json!({ "name": "Urgentes", "filter_type": "conversation", "query": query }),
        )
        .await;
    assert_eq!(view.status, 200);
    assert_eq!(view.body["query"], query);
    let contact_query = json!({ "payload": [condition("email", "is_present", json!([]), "and")] });
    maria
        .post(
            "/custom_filters",
            json!({ "name": "Com e-mail", "filter_type": "contact", "query": contact_query }),
        )
        .await;
    let bad = json!({ "name": "Ruim", "query": { "payload": [condition("bogus", "equal_to", json!(["x"]), "and")] } });
    assert_eq!(maria.post("/custom_filters", bad).await.status, 400);
    assert_eq!(
        maria
            .post("/custom_filters", json!({ "name": "Sem query" }))
            .await
            .status,
        400
    );
    assert_eq!(maria.get("/custom_filters").await.body.as_array().unwrap().len(), 2);
    let only = maria.get("/custom_filters?filter_type=contact").await.body;
    assert_eq!(only[0]["name"], "Com e-mail");
    assert!(admin.get("/custom_filters").await.body.as_array().unwrap().is_empty());
    let id = view.body["id"].as_i64().unwrap();
    let path = format!("/custom_filters/{id}");
    assert_eq!(admin.patch(&path, json!({ "name": "Meu" })).await.status, 404);
    assert_eq!(maria.patch(&path, json!({})).await.status, 400);
    let renamed = maria.patch(&path, json!({ "name": "Prioridade máxima" })).await.body;
    assert_eq!(renamed["name"], "Prioridade máxima");
    let bad_update = json!({ "query": { "payload": [] } });
    assert_eq!(maria.patch(&path, bad_update).await.status, 400);
    let new_query = json!({ "payload": [condition("status", "equal_to", json!(["open"]), "and")] });
    let updated = maria.patch(&path, json!({ "query": new_query })).await.body;
    assert_eq!(updated["query"], new_query);
    assert_eq!(admin.del(&path, None).await.status, 404);
    assert_eq!(maria.del(&path, None).await.status, 200);
    assert_eq!(maria.get("/custom_filters").await.body.as_array().unwrap().len(), 1);
}
