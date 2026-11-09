//! Plugins over HTTP: administrators install a manifest, its skills land in the skill library,
//! its tools reach the endpoint with the sealed credential applied by the server, and turning
//! the plugin off takes its tools away from the agents.
use crate::common::Fixture;
use axum::http::HeaderMap;
use axum::routing::post;
use axum::{Json, Router};
use serde_json::{json, Value};
use wamcp_server::application::ports::BusinessTools;

/// A plugin endpoint on this computer that echoes the bearer it got and the arguments.
async fn endpoint() -> String {
    async fn order(headers: HeaderMap, Json(args): Json<Value>) -> Json<Value> {
        let bearer = headers
            .get("authorization")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_string();
        Json(json!({ "bearer": bearer, "pedido": args["item"] }))
    }
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let router = Router::new().route("/pedido", post(order));
    tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
    format!("http://{address}/pedido")
}

fn manifest(url: &str) -> Value {
    json!({
        "id": "delivery", "name": "Delivery", "version": "1.0.0",
        "skills": [{"name": "Atender pedido", "instructions": "Anote o pedido e confirme."}],
        "credentials": [{"name": "token", "help": "Chave da loja"}],
        "tools": [{
            "name": "anotar_pedido", "description": "Anota um pedido",
            "input_schema": {"type": "object", "properties": {"item": {"type": "string"}}},
            "side_effects": true,
            "endpoint": {"kind": "http", "url": url, "credential": "token"}
        }]
    })
}

#[tokio::test]
async fn administrators_install_plugins_whose_tools_carry_the_sealed_credential() {
    let f = Fixture::new().await;
    let admin = f.bootstrap().await;

    let listed = admin.get("/plugins").await;
    assert_eq!(listed.status, 200, "{:?}", listed.body);
    assert!(listed.body.to_string().contains("\"financeiro\""));
    assert_eq!(admin.del("/plugins/financeiro", None).await.status, 422);

    let agent = f.agent(&admin, "ana@example.com", "agent", false).await;
    assert_eq!(agent.get("/plugins").await.status, 403);

    let refused = admin.post("/plugins", manifest("http://example.com/pedido")).await;
    assert_eq!(
        refused.status, 400,
        "plain HTTP outside this computer: {:?}",
        refused.body
    );

    let url = endpoint().await;
    let installed = admin.post("/plugins", manifest(&url)).await;
    assert_eq!(installed.status, 201, "{:?}", installed.body);
    let skills = admin.get("/skills").await.body.to_string();
    assert!(skills.contains("Delivery: Atender pedido"), "{skills}");
    assert!(skills.contains("delivery.anotar_pedido"), "{skills}");

    let plugins = f.app.state.support().plugins.clone();
    let args = json!({"item": "pizza"});
    let missing = plugins.call(1, "delivery.anotar_pedido", &args).await;
    assert!(missing.is_err(), "no credential yet");

    let set = admin
        .put("/plugins/delivery/credentials/token", json!({"value": "s3gredo"}))
        .await;
    assert_eq!(set.status, 200, "{:?}", set.body);
    assert_eq!(set.body["credentials_set"], json!(["token"]));
    assert!(!set.body.to_string().contains("s3gredo"), "never shown back");
    let answer = plugins.call(1, "delivery.anotar_pedido", &args).await.unwrap();
    assert_eq!(answer, json!({"bearer": "Bearer s3gredo", "pedido": "pizza"}));
    assert!(plugins.tools(1).iter().any(|t| t.name == "delivery.anotar_pedido"));

    let off = admin.patch("/plugins/delivery", json!({"enabled": false})).await;
    assert_eq!(off.status, 200, "{:?}", off.body);
    assert!(!plugins.tools(1).iter().any(|t| t.name == "delivery.anotar_pedido"));
    assert!(plugins.call(1, "delivery.anotar_pedido", &args).await.is_err());

    assert_eq!(admin.del("/plugins/delivery", None).await.status, 200);
    let skills = admin.get("/skills").await.body.to_string();
    assert!(!skills.contains("Delivery: Atender pedido"), "{skills}");
}

/// Serves `plugin.json` with whatever manifest the test puts in `current`.
async fn manifest_server(current: std::sync::Arc<parking_lot::Mutex<Value>>) -> String {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let router = Router::new().route(
        "/plugin.json",
        axum::routing::get(move || {
            let current = current.clone();
            async move { Json(current.lock().clone()) }
        }),
    );
    tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
    format!("http://{address}/plugin.json")
}

#[tokio::test]
async fn plugins_installed_from_an_address_update_to_newer_versions_only() {
    let f = Fixture::new().await;
    let admin = f.bootstrap().await;
    let tool = endpoint().await;
    let current = std::sync::Arc::new(parking_lot::Mutex::new(manifest(&tool)));
    let url = manifest_server(current.clone()).await;

    let installed = admin.post("/plugins", json!({ "url": url })).await;
    assert_eq!(installed.status, 201, "{:?}", installed.body);
    assert_eq!(installed.body["source"], url.as_str());
    let set = admin
        .put("/plugins/delivery/credentials/token", json!({"value": "s3gredo"}))
        .await;
    assert_eq!(set.status, 200);

    let same = admin.post("/plugins/delivery/update", json!({})).await;
    assert_eq!(same.status, 200, "{:?}", same.body);
    assert_eq!(same.body["updated"], false);

    current.lock()["version"] = json!("1.1.0");
    current.lock()["skills"][0]["instructions"] = json!("Confirme o endereço também.");
    let newer = admin.post("/plugins/delivery/update", json!({})).await;
    assert_eq!(newer.status, 200, "{:?}", newer.body);
    assert_eq!(newer.body["updated"], true);
    assert_eq!(newer.body["previous_version"], "1.0.0");
    assert_eq!(newer.body["plugin"]["manifest"]["version"], "1.1.0");
    assert_eq!(
        newer.body["plugin"]["credentials_set"],
        json!(["token"]),
        "credentials stay"
    );
    assert!(admin
        .get("/skills")
        .await
        .body
        .to_string()
        .contains("Confirme o endereço também."));

    let older = admin.post("/plugins", manifest(&tool)).await;
    assert_eq!(older.status, 409, "no silent downgrade: {:?}", older.body);
    let mut bad = manifest(&tool);
    bad["version"] = json!("um");
    assert_eq!(admin.post("/plugins", bad).await.status, 400);
    let pasted = admin.post("/plugins/financeiro/update", json!({})).await;
    assert_eq!(pasted.status, 422, "not installed from an address");
}
