//! Advanced filters and custom attributes (Chatwoot parity M5).
mod common;

use common::filters::{condition, displays, filter, setup};
use common::Fixture;
use serde_json::{json, Value};

#[tokio::test]
async fn filters_conversations_with_chatwoot_operators() {
    let f = Fixture::new().await;
    let admin = setup(&f).await;
    let urgent = filter(
        &admin,
        vec![
            condition("status", "equal_to", json!(["open"]), "and"),
            condition("priority", "equal_to", json!(["urgent"]), "and"),
        ],
    )
    .await;
    assert_eq!(displays(&urgent.body), vec![2]);
    let either = filter(
        &admin,
        vec![
            condition("labels", "equal_to", json!(["vip"]), "or"),
            condition("priority", "equal_to", json!(["urgent"]), "and"),
        ],
    )
    .await;
    assert_eq!(displays(&either.body), vec![2, 1]);
    let cases = [
        (condition("priority", "is_not_present", json!([]), "and"), vec![3, 1]),
        (condition("priority", "is_present", json!([]), "and"), vec![2]),
        (
            condition("priority", "not_equal_to", json!(["urgent"]), "and"),
            vec![3, 1],
        ),
        (condition("contact_name", "contains", json!(["ar"]), "and"), vec![3]),
        (
            condition("contact_name", "does_not_contain", json!(["ar"]), "and"),
            vec![2, 1],
        ),
        (condition("labels", "not_equal_to", json!(["vip"]), "and"), vec![3, 2]),
        (condition("labels", "is_present", json!([]), "and"), vec![1]),
        (condition("labels", "is_not_present", json!([]), "and"), vec![3, 2]),
        (condition("labels", "contains", json!(["vi"]), "and"), vec![1]),
        (
            condition("labels", "does_not_contain", json!(["vi"]), "and"),
            vec![3, 2],
        ),
        (
            condition("display_id", "is_greater_than", json!([1]), "and"),
            vec![3, 2],
        ),
        (condition("display_id", "is_less_than", json!(["3"]), "and"), vec![2, 1]),
        (condition("last_activity_at", "days_before", json!([1]), "and"), vec![1]),
        (
            condition("created_at", "is_greater_than", json!(["2000-01-01"]), "and"),
            vec![3, 2, 1],
        ),
    ];
    for (c, expected) in cases {
        let found = filter(&admin, vec![c.clone()]).await;
        assert_eq!(displays(&found.body), expected, "{c}");
    }
    let invalid = [
        condition("bogus", "equal_to", json!(["x"]), "and"),
        condition("status", "sounds_like", json!(["x"]), "and"),
        condition("status", "is_greater_than", json!(["x"]), "and"),
        condition("status", "equal_to", json!([]), "and"),
        condition("status", "equal_to", json!(["open"]), "xor"),
    ];
    for c in invalid {
        assert_eq!(filter(&admin, vec![c.clone()]).await.status, 400, "{c}");
    }
    assert_eq!(filter(&admin, vec![]).await.status, 400);
    let outsider = f.agent(&admin, "fora@example.com", "agent", false).await;
    let hidden = filter(&outsider, vec![condition("status", "equal_to", json!(["open"]), "and")]).await;
    assert!(hidden.body.as_array().unwrap().is_empty());
}

#[tokio::test]
async fn custom_attributes_are_typed_validated_and_filterable() {
    let f = Fixture::new().await;
    let admin = setup(&f).await;
    let agent = f.agent(&admin, "maria@example.com", "agent", true).await;
    let plan = json!({ "attribute_display_name": "Plano contratado", "attribute_model": "conversation",
        "attribute_display_type": "list", "attribute_values": ["basico", "pro"] });
    assert_eq!(
        agent.post("/custom_attribute_definitions", plan.clone()).await.status,
        403
    );
    let created = admin.post("/custom_attribute_definitions", plan.clone()).await.body;
    assert_eq!(created["attribute_key"], "plano_contratado");
    assert_eq!(admin.post("/custom_attribute_definitions", plan).await.status, 422);
    let bad = [
        json!({ "attribute_display_name": "Lista", "attribute_model": "conversation", "attribute_display_type": "list" }),
        json!({ "attribute_display_name": "X", "attribute_model": "ticket" }),
        json!({ "attribute_display_name": "Cpf", "attribute_model": "contact", "regex_pattern": "([" }),
        json!({ "attribute_display_name": "!!!", "attribute_model": "contact" }),
    ];
    for body in bad {
        assert_eq!(
            admin.post("/custom_attribute_definitions", body.clone()).await.status,
            400,
            "{body}"
        );
    }
    let score = json!({ "attribute_display_name": "Valor", "attribute_model": "conversation", "attribute_display_type": "currency" });
    admin.post("/custom_attribute_definitions", score).await;
    let cpf = json!({ "attribute_display_name": "CPF", "attribute_model": "contact",
        "regex_pattern": "^\\d{11}$", "regex_cue": "Somente números" });
    let cpf = admin.post("/custom_attribute_definitions", cpf).await.body;
    let listed = agent
        .get("/custom_attribute_definitions?attribute_model=conversation")
        .await
        .body;
    assert_eq!(listed.as_array().unwrap().len(), 2);

    let set = |display: i64, attrs: Value| {
        let agent = &agent;
        async move {
            agent
                .post(
                    &format!("/conversations/{display}/custom_attributes"),
                    json!({ "custom_attributes": attrs }),
                )
                .await
        }
    };
    let ok = set(1, json!({ "plano_contratado": "pro", "valor": 150, "origem": "site" })).await;
    assert_eq!(
        ok.body["custom_attributes"],
        json!({ "plano_contratado": "pro", "valor": 150, "origem": "site" })
    );
    set(2, json!({ "plano_contratado": "basico", "valor": 90.5 })).await;
    assert_eq!(set(3, json!({ "plano_contratado": "gold" })).await.status, 400);
    assert_eq!(set(3, json!({ "valor": "caro" })).await.status, 400);
    assert_eq!(set(3, json!({ "Chave Ruim": 1 })).await.status, 400);
    let cleared = set(1, json!({ "origem": null })).await.body;
    assert_eq!(
        cleared["custom_attributes"],
        json!({ "plano_contratado": "pro", "valor": 150 })
    );

    let pro = filter(
        &agent,
        vec![condition(
            "custom_attribute:plano_contratado",
            "equal_to",
            json!(["pro"]),
            "and",
        )],
    )
    .await;
    assert_eq!(displays(&pro.body), vec![1]);
    let rich = filter(
        &agent,
        vec![condition(
            "custom_attribute:valor",
            "is_greater_than",
            json!([100]),
            "and",
        )],
    )
    .await;
    assert_eq!(displays(&rich.body), vec![1]);
    let unset = filter(
        &agent,
        vec![condition("custom_attribute:valor", "is_not_present", json!([]), "and")],
    )
    .await;
    assert_eq!(displays(&unset.body), vec![3]);
    let unknown = filter(
        &agent,
        vec![condition("custom_attribute:nada", "equal_to", json!(["x"]), "and")],
    )
    .await;
    assert_eq!(unknown.status, 400);

    let patch = agent
        .patch(
            "/contacts/1",
            json!({ "name": "Ana Paula", "custom_attributes": { "cpf": "12345678901" } }),
        )
        .await;
    assert_eq!(
        (
            patch.body["name"].as_str(),
            patch.body["custom_attributes"]["cpf"].as_str()
        ),
        (Some("Ana Paula"), Some("12345678901"))
    );
    assert_eq!(
        agent
            .patch("/contacts/2", json!({ "custom_attributes": { "cpf": "123" } }))
            .await
            .status,
        400
    );
    let contacts = agent
        .post(
            "/contacts/filter",
            json!({ "payload": [condition("custom_attribute:cpf", "is_present", json!([]), "and")] }),
        )
        .await
        .body;
    let names: Vec<Value> = contacts.as_array().unwrap().iter().map(|c| c["name"].clone()).collect();
    assert_eq!(names, vec![json!("Ana Paula")]);
    let by_name = agent
        .post(
            "/contacts/filter",
            json!({ "payload": [condition("name", "contains", json!(["Br"]), "and")] }),
        )
        .await;
    assert_eq!(by_name.body.as_array().unwrap().len(), 1);

    let id = cpf["id"].as_i64().unwrap();
    let renamed = admin
        .patch(
            &format!("/custom_attribute_definitions/{id}"),
            json!({ "attribute_display_name": "Documento", "regex_cue": null }),
        )
        .await
        .body;
    assert_eq!(
        (renamed["attribute_display_name"].as_str(), renamed["regex_cue"].clone()),
        (Some("Documento"), Value::Null)
    );
    assert_eq!(
        agent
            .del(&format!("/custom_attribute_definitions/{id}"), None)
            .await
            .status,
        403
    );
    assert_eq!(
        admin
            .del(&format!("/custom_attribute_definitions/{id}"), None)
            .await
            .status,
        200
    );
    assert_eq!(
        admin
            .del(&format!("/custom_attribute_definitions/{id}"), None)
            .await
            .status,
        404
    );
}
