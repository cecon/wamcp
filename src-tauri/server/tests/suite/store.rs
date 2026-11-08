//! The store: the catalog at the account's address, with what is installed here; installing a
//! skill; and an agent template that installs its plugin, fills the credential, creates the agent
//! with the plugin's skills, connects it to the inbox, grants its tools and creates its routines.
use crate::common;

use axum::extract::Path;
use axum::routing::get;
use axum::{Json, Router};
use common::Fixture;
use parking_lot::Mutex;
use serde_json::{json, Value};
use std::sync::Arc;
use wamcp_server::application::ports::AgentRuntime;

fn shipped(file: &str) -> Value {
    let path = format!("{}/../../plugins/{file}", env!("CARGO_MANIFEST_DIR"));
    serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
}

/// Serves the repository's `plugins/` folder (the catalog may be changed by the test).
async fn publish(catalog: Arc<Mutex<Value>>) -> String {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let served = catalog.clone();
    let router = Router::new()
        .route("/catalog.json", get(move || async move { Json(served.lock().clone()) }))
        .route(
            "/{plugin}/plugin.json",
            get(|Path(plugin): Path<String>| async move { Json(shipped(&format!("{plugin}/plugin.json"))) }),
        );
    tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
    format!("http://{address}/catalog.json")
}

#[tokio::test]
async fn an_agent_template_sets_up_everything_its_plugin_needs() {
    let f = Fixture::new().await;
    let runtime = Arc::new(crate::engine_support::ScriptedRuntime::default());
    f.app.attach_engine(
        f.store.clone(),
        vec![("opencode".into(), runtime as Arc<dyn AgentRuntime>)],
        "opencode",
        None,
    );
    f.session("Escritório");
    let admin = f.bootstrap().await;
    let inbox = admin.get("/inboxes").await.body[0]["id"].as_i64().unwrap();
    let catalog = Arc::new(Mutex::new(shipped("catalog.json")));
    let source = publish(catalog.clone()).await;

    let pointed = admin.put("/store/source", json!({ "url": source })).await;
    assert_eq!(pointed.status, 200, "{:?}", pointed.body);
    let store = admin.get("/store").await;
    assert_eq!(store.status, 200, "{:?}", store.body);
    assert_eq!(store.body["source"], source.as_str());
    assert_eq!(store.body["default_source"], false);
    let ids: Vec<&str> = store.body["agents"]
        .as_array()
        .unwrap()
        .iter()
        .map(|a| a["id"].as_str().unwrap())
        .collect();
    assert_eq!(ids, ["contador", "delivery", "suporte"]);
    assert!(store.body["plugins"][0]["installed"].is_null());

    let preview = admin.get("/store/agents/contador").await;
    assert_eq!(preview.status, 200, "{:?}", preview.body);
    assert_eq!(preview.body["manifest"]["credentials"][0]["name"], "token");

    let body = json!({"name": "Cora", "credentials": {"token": "t0k3n"}, "inbox_id": inbox});
    let installed = admin.post("/store/agents/contador", body).await;
    assert_eq!(installed.status, 201, "{:?}", installed.body);
    let outcome = &installed.body;
    assert_eq!(outcome["pending"], json!([]), "{outcome}");
    assert_eq!(outcome["agent"]["name"], "Cora");
    assert_eq!(outcome["agent"]["runtime"], "opencode");
    assert!(outcome["agent"]["instructions"]
        .as_str()
        .unwrap()
        .contains("## Objetivos"));
    assert_eq!(outcome["agent"]["skill_ids"].as_array().unwrap().len(), 3);
    assert_eq!(outcome["plugin"]["credentials_set"], json!(["token"]));
    assert_eq!(outcome["granted"].as_array().unwrap().len(), 6);
    assert_eq!(
        outcome["routines"],
        json!(["Contador: Cobrar documentos do mês", "Contador: Lembrar prazos"])
    );

    let agent = outcome["agent"]["id"].as_i64().unwrap();
    let policy = admin.get(&format!("/engine/agents/{agent}/policy")).await.body;
    let grants = policy["grants"].to_string();
    assert!(
        grants.contains("contador.pendencias") && grants.contains("mensagens.enviar_whatsapp"),
        "{grants}"
    );
    let schedules = admin.get("/agent_schedules").await.body;
    let mine: Vec<&Value> = schedules
        .as_array()
        .unwrap()
        .iter()
        .filter(|s| s["agent_ids"] == json!([agent]))
        .collect();
    assert_eq!(mine.len(), 2, "{schedules}");
    let inboxes = admin.get("/inboxes").await.body;
    assert_eq!(inboxes[0]["ai_agent_id"], agent, "{inboxes}");

    // Installed now; a newer version in the store shows as an update.
    let store = admin.get("/store").await.body;
    assert_eq!(store["plugins"][0]["installed"]["version"], "1.0.0");
    assert_eq!(store["plugins"][0]["installed"]["update"], false);
    catalog.lock()["plugins"][0]["version"] = json!("1.1.0");
    let store = admin.get("/store").await.body;
    assert_eq!(store["plugins"][0]["installed"]["update"], true);
    assert_eq!(store["agents"][0]["plugin_installed"]["update"], true);

    // A skill alone, and the default address back.
    let skill = admin.post("/store/plugins/suporte", json!({})).await;
    assert_eq!(skill.status, 201, "{:?}", skill.body);
    assert_eq!(skill.body["manifest"]["id"], "suporte");
    assert_eq!(admin.post("/store/plugins/nada", json!({})).await.status, 404);
    let reset = admin.put("/store/source", json!({ "url": null })).await;
    assert!(reset.body["source"].as_str().unwrap().starts_with("https://"));
}

#[tokio::test]
async fn without_the_engine_or_a_credential_the_agent_is_created_with_what_is_left_to_do() {
    let f = Fixture::new().await;
    let admin = f.bootstrap().await;
    let source = publish(Arc::new(Mutex::new(shipped("catalog.json")))).await;
    admin.put("/store/source", json!({ "url": source })).await;
    let roster = admin.get("/agent_directory").await.body.as_array().unwrap().len();

    let refused = admin
        .post("/store/agents/delivery", json!({"credentials": {"senha": "x"}}))
        .await;
    assert_eq!(refused.status, 422, "{:?}", refused.body);
    assert_eq!(
        admin.get("/agent_directory").await.body.as_array().unwrap().len(),
        roster
    );

    let installed = admin.post("/store/agents/delivery", json!({})).await;
    assert_eq!(installed.status, 201, "{:?}", installed.body);
    assert_eq!(installed.body["agent"]["name"], "Atendente do delivery");
    let pending = installed.body["pending"].to_string();
    assert!(pending.contains("credencial token"), "{pending}");
    assert!(pending.contains("motor de agentes"), "{pending}");
    assert_eq!(installed.body["routines"].as_array().unwrap().len(), 1);

    let wrong = admin
        .put("/store/source", json!({ "url": "http://example.org/c.json" }))
        .await;
    assert_eq!(wrong.status, 400);
}
