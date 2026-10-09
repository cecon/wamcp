//! The inbox assistant's catalog tools on the modern MCP protocol: search, item details, quote and
//! sending an item (photo + caption) to a conversation of the session's inbox.
mod common;
mod mcp_support;

use common::Incoming;
use mcp_support::Mcp;
use serde_json::{json, Value};

const PNG: &[u8] = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR";

struct Menu {
    m: Mcp,
    burger: i64,
    coca: i64,
    bacon: i64,
}

async fn menu() -> Menu {
    let m = Mcp::new().await;
    let admin = m.f.bootstrap().await;
    let category = admin
        .post("/catalog/categories", json!({ "name": "Lanches" }))
        .await
        .body;
    let drinks = admin
        .post("/catalog/groups", json!({ "name": "Escolha a bebida", "options": [{ "product": { "name": "Coca-Cola" }, "external_code": "COCA" }] }))
        .await
        .body;
    let extras = admin
        .post(
            "/catalog/groups",
            json!({ "name": "Adicionais", "options": [{ "product": { "name": "Bacon" }, "price_cents": 400 }] }),
        )
        .await
        .body;
    let groups =
        json!([{ "group_id": drinks["id"], "min": 1, "max": 1 }, { "group_id": extras["id"], "min": 0, "max": 3 }]);
    let burger = admin
        .post("/catalog/items", json!({ "category_id": category["id"], "price_cents": 2990, "original_price_cents": 3490, "external_code": "XB01",
            "product": { "name": "X-Burger", "description": "Pão brioche e hambúrguer 150 g" }, "groups": groups }))
        .await
        .body;
    let paused = json!({ "category_id": category["id"], "price_cents": 1000, "status": "unavailable", "product": { "name": "X-Burger vegano" } });
    admin.post("/catalog/items", paused).await;
    let product = burger["product"]["id"].as_i64().unwrap();
    let photo = media_photo(&m, product);
    assert!(photo.starts_with("/api/v1/catalog/images/"));
    Menu {
        burger: burger["id"].as_i64().unwrap(),
        coca: drinks["options"][0]["id"].as_i64().unwrap(),
        bacon: extras["options"][0]["id"].as_i64().unwrap(),
        m,
    }
}

fn media_photo(m: &Mcp, product: i64) -> String {
    let file =
        m.f.app
            .state
            .support()
            .menu
            .upload_image(&admin_actor(m), product, PNG)
            .expect("photo");
    serde_json::to_value(&file).unwrap()["image_url"]
        .as_str()
        .unwrap()
        .to_string()
}

fn admin_actor(_m: &Mcp) -> wamcp_server::domain::actor::Actor {
    wamcp_server::domain::actor::Actor::system("test", "Teste")
}

async fn call(m: &Mcp, name: &str, arguments: Value, credential: &str) -> Value {
    let reply = m
        .rpc(
            "tools/call",
            json!({ "name": name, "arguments": arguments }),
            credential,
            &[],
        )
        .await;
    assert_eq!(reply.status, 200, "{}", reply.text);
    reply.body["result"].clone()
}

fn text(result: &Value) -> String {
    result["content"][0]["text"].as_str().unwrap_or_default().to_string()
}

#[tokio::test]
async fn catalog_tools_are_listed_with_their_scopes() {
    let m = Mcp::new().await;
    let tools = m.rpc("tools/list", json!({}), "reader", &[]).await.body["result"]["tools"].clone();
    let catalog: Vec<(&str, &Value)> = tools
        .as_array()
        .unwrap()
        .iter()
        .filter(|t| t["name"].as_str().unwrap().starts_with("catalog_"))
        .map(|t| (t["name"].as_str().unwrap(), &t["securitySchemes"][0]["scopes"]))
        .collect();
    let names: Vec<&str> = catalog.iter().map(|(n, _)| *n).collect();
    assert_eq!(
        names,
        ["catalog_search", "catalog_item", "catalog_quote", "catalog_send_item"]
    );
    assert_eq!(catalog[3].1, &json!(["whatsapp:read", "whatsapp:send"]));
    assert_eq!(catalog[0].1, &json!(["whatsapp:read"]));
}

#[tokio::test]
async fn search_item_and_quote_answer_in_portuguese_with_prices_and_codes() {
    let t = menu().await;
    let found = text(&call(&t.m, "catalog_search", json!({ "query": "burger" }), "reader").await);
    assert_eq!(
        found,
        format!("Itens disponíveis (1):\n[item {}] X-Burger — R$ 29,90 (de R$ 34,90) · código XB01 · tem complementos obrigatórios", t.burger)
    );
    let none = text(&call(&t.m, "catalog_search", json!({ "query": "pizza" }), "reader").await);
    assert_eq!(none, "Nenhum item disponível agora encontrado no cardápio.");

    let detail = text(&call(&t.m, "catalog_item", json!({ "item_id": t.burger }), "reader").await);
    assert!(detail.contains("Pão brioche e hambúrguer 150 g"), "{detail}");
    assert!(detail.contains("Disponível agora: sim"), "{detail}");
    assert!(
        detail.contains("• Escolha a bebida (obrigatório: escolha 1)"),
        "{detail}"
    );
    assert!(
        detail.contains(&format!("[opção {}] Coca-Cola — + R$ 0,00 · código COCA", t.coca)),
        "{detail}"
    );
    assert!(detail.contains("• Adicionais (opcional, até 3)"), "{detail}");
    let missing = call(&t.m, "catalog_item", json!({ "item_id": 999 }), "reader").await;
    assert_eq!(
        (missing["isError"].clone(), text(&missing)),
        (json!(true), "Item não encontrado".to_string())
    );

    let order = json!({ "item_id": t.burger, "quantity": 2, "choices": [{ "option_id": t.coca }, { "option_id": t.bacon, "quantity": 1 }] });
    let quote = text(&call(&t.m, "catalog_quote", order, "reader").await);
    assert!(quote.starts_with("Total: R$ 67,80 (2 × R$ 33,90)"), "{quote}");
    assert!(quote.contains("- 1× X-Burger R$ 29,90 · código XB01"), "{quote}");
    assert!(quote.contains("- 1× Bacon R$ 4,00"), "{quote}");
    let incomplete = text(
        &call(
            &t.m,
            "catalog_quote",
            json!({ "item_id": t.burger, "notes": "sem cebola" }),
            "reader",
        )
        .await,
    );
    assert!(
        incomplete.contains("O pedido ainda não pode ser fechado:\n- Escolha 1 opção em ‘Escolha a bebida’"),
        "{incomplete}"
    );
    let invalid = call(
        &t.m,
        "catalog_quote",
        json!({ "item_id": t.burger, "choices": [{ "quantity": 1 }] }),
        "reader",
    )
    .await;
    assert_eq!(invalid["isError"], true);
    let schema = call(
        &t.m,
        "catalog_quote",
        json!({ "item_id": t.burger, "choices": ["x"] }),
        "reader",
    )
    .await;
    assert_eq!(schema["isError"], true);
    assert!(t.m.audit_count() >= 4, "reads are audited");
}

#[tokio::test]
async fn send_item_replies_with_photo_and_caption_in_the_bots_inbox_only() {
    let t = menu().await;
    t.m.f.incoming(
        &t.m.session.id,
        Incoming {
            id: "IN1",
            body: "Tem hambúrguer?",
            ..Default::default()
        },
    );
    let args = json!({ "conversation_id": 1, "item_id": t.burger });
    let denied = call(&t.m, "catalog_send_item", args.clone(), "reader").await;
    assert_eq!(denied["isError"], true, "needs the send scope");
    let sent = call(&t.m, "catalog_send_item", args, "writer").await;
    assert_eq!(sent.get("isError"), None, "{sent}");
    assert!(
        text(&sent).starts_with("Enviado (foto e descrição) de ‘X-Burger’ na mensagem"),
        "{sent}"
    );
    let requests = t.m.f.wa.requests.lock().clone();
    let request = requests.last().expect("media sent");
    let media = request.media.as_ref().expect("photo");
    assert_eq!((media.mime_type.as_str(), media.bytes.as_slice()), ("image/png", PNG));
    assert_eq!(
        media.caption.as_deref(),
        Some("*X-Burger*\nPão brioche e hambúrguer 150 g\nR$ 29,90 (de R$ 34,90)")
    );
    let other = call(
        &t.m,
        "catalog_send_item",
        json!({ "conversation_id": 99, "item_id": t.burger }),
        "writer",
    )
    .await;
    assert_eq!(
        (other["isError"].clone(), text(&other)),
        (json!(true), "Conversa não encontrada".to_string())
    );
    let paused =
        t.m.f
            .app
            .state
            .support()
            .menu
            .search(&admin_actor(&t.m), "vegano", false)
            .unwrap()[0]
            .item
            .id;
    let unavailable = call(
        &t.m,
        "catalog_send_item",
        json!({ "conversation_id": 1, "item_id": paused }),
        "writer",
    )
    .await;
    assert_eq!(text(&unavailable), "‘X-Burger vegano’ não está disponível agora");
    t.m.f.wa.fail_with(Some("Sessão desconectada"));
    let failed = call(
        &t.m,
        "catalog_send_item",
        json!({ "conversation_id": 1, "item_id": t.burger }),
        "writer",
    )
    .await;
    assert_eq!(
        (failed["isError"].clone(), text(&failed)),
        (json!(true), "Não foi possível enviar: Sessão desconectada".to_string())
    );
}
