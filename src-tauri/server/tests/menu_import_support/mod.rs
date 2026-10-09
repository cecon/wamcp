//! Helpers for the import API tests: fixtures, scripted crawls and polling.
#![allow(dead_code)]
use crate::common::{Agent, Fixture};
use serde_json::{json, Value};
use std::time::Duration;
use wamcp_server::adapters::outbound::crawler::memory::Script;
use wamcp_server::application::ports::CrawlStatus;

pub const STORE: &str = "https://www.ifood.com.br/delivery/sao-paulo-sp/burger-joint/1234-abcd";
pub const JPG: &[u8] = &[0xFF, 0xD8, 0xFF, 0xE0, 0, 0x10];

pub fn fixture(name: &str) -> Value {
    let path = format!("{}/tests/fixtures/ifood/{name}", env!("CARGO_MANIFEST_DIR"));
    serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
}

pub fn script(payloads: Vec<Value>) -> Script {
    Script {
        statuses: vec![CrawlStatus::Opening, CrawlStatus::Loading],
        payloads,
        ..Script::default()
    }
}

/// Polls the import until it reaches `status`.
pub async fn wait(admin: &Agent, id: &str, status: &str) -> Value {
    for _ in 0..400 {
        let reply = admin.get(&format!("/catalog/imports/{id}")).await;
        if reply.body["status"] == status {
            return reply.body;
        }
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
    panic!(
        "import {id} never reached {status}: {}",
        admin.get(&format!("/catalog/imports/{id}")).await.text
    );
}

pub async fn start(admin: &Agent) -> String {
    let reply = admin.post("/catalog/imports", json!({ "url": STORE })).await;
    assert_eq!(reply.status, 201, "{}", reply.text);
    assert_eq!(reply.body["status"], "starting");
    reply.body["id"].as_str().unwrap().to_string()
}

pub async fn imported(f: &Fixture, admin: &Agent, payload: &str, mode: &str) -> Value {
    f.crawler
        .set(script(vec![json!({ "unrelated": true }), fixture(payload)]));
    let id = start(admin).await;
    wait(admin, &id, "ready").await;
    let applied = admin
        .post(&format!("/catalog/imports/{id}/apply"), json!({ "mode": mode }))
        .await;
    assert_eq!(applied.status, 200, "{}", applied.text);
    assert_eq!(applied.body["status"], "applied");
    applied.body
}

pub fn names(menu: &Value) -> Vec<String> {
    menu["categories"]
        .as_array()
        .unwrap()
        .iter()
        .flat_map(|c| c["items"].as_array().unwrap().iter())
        .map(|i| i["product"]["name"].as_str().unwrap().to_string())
        .collect()
}
