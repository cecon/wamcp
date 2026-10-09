//! iFood import failures over HTTP: crawler errors, missing menu, timeout and request validation.
mod common;
mod menu_import_support;

use common::Fixture;
use menu_import_support::*;
use serde_json::json;
use std::time::Duration;
use wamcp_server::adapters::outbound::crawler::memory::Script;

#[tokio::test]
async fn failures_are_explained_in_portuguese() {
    let f = Fixture::new().await;
    let admin = f.bootstrap().await;
    f.crawler.set(Script {
        error: Some("Instale o Microsoft Edge ou o Google Chrome para importar do iFood".into()),
        ..Script::default()
    });
    let id = start(&admin).await;
    let failed = wait(&admin, &id, "failed").await;
    assert_eq!(
        failed["message"],
        "Instale o Microsoft Edge ou o Google Chrome para importar do iFood"
    );
    assert_eq!(admin.del(&format!("/catalog/imports/{id}"), None).await.status, 409);

    f.crawler.set(script(vec![json!({ "page": "sem cardápio" })]));
    let id = start(&admin).await;
    let failed = wait(&admin, &id, "failed").await;
    assert_eq!(
        failed["message"],
        "Não encontramos o cardápio na página. Confira o link da loja e tente de novo."
    );

    let mut menu = f.app.state.support().menu.clone();
    menu.crawl_limit = Duration::from_millis(30);
    f.crawler.set(Script {
        hold: true,
        ..Script::default()
    });
    let actor = wamcp_server::domain::actor::Actor::system("test", "Teste");
    let slow = menu.start_import(&actor, STORE).unwrap();
    let failed = wait(&admin, &slow.id, "failed").await;
    assert_eq!(
        failed["message"],
        "A importação passou do limite de 5 minutos sem encontrar o cardápio."
    );
}

#[tokio::test]
async fn import_requests_are_validated() {
    let f = Fixture::new().await;
    let admin = f.bootstrap().await;
    for url in ["https://evil.com/delivery/x", "http://www.ifood.com.br/delivery/x", ""] {
        let reply = admin.post("/catalog/imports", json!({ "url": url })).await;
        assert_eq!(reply.status, 400, "{url}");
    }
    let wrong = admin
        .post("/catalog/imports", json!({ "url": "https://evil.com/delivery/x" }))
        .await;
    assert_eq!(
        wrong.body["error"],
        "Use o link da loja no iFood (https://www.ifood.com.br/delivery/…)"
    );
    assert_eq!(admin.get("/catalog/imports/nope").await.status, 404);
    assert_eq!(
        admin
            .post("/catalog/imports/nope/apply", json!({ "mode": "merge" }))
            .await
            .status,
        404
    );
    f.crawler.set(script(vec![fixture("acai_v2.json")]));
    let id = start(&admin).await;
    wait(&admin, &id, "ready").await;
    let mode = admin
        .post(&format!("/catalog/imports/{id}/apply"), json!({ "mode": "upsert" }))
        .await;
    assert_eq!(
        (mode.status, mode.body["error"].clone()),
        (400, json!("Modo inválido (use merge ou replace)"))
    );
}
