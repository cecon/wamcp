//! Shared helpers for the advanced filter tests.
use super::{Agent, Fixture, Incoming};
use serde_json::{json, Value};

pub fn displays(list: &Value) -> Vec<i64> {
    assert!(list.is_array(), "{list}");
    list.as_array()
        .unwrap()
        .iter()
        .filter_map(|c| c["display_id"].as_i64())
        .collect()
}

pub fn condition(key: &str, op: &str, values: Value, joiner: &str) -> Value {
    json!({ "attribute_key": key, "filter_operator": op, "values": values, "query_operator": joiner })
}

pub async fn filter(agent: &Agent, conditions: Vec<Value>) -> super::http::Reply {
    agent
        .post("/conversations/filter", json!({ "payload": conditions }))
        .await
}

pub async fn setup(f: &Fixture) -> Agent {
    let session = f.session("Suporte");
    let admin = f.bootstrap().await;
    let people = [
        ("5511900000001", "Ana"),
        ("5511900000002", "Bruno"),
        ("5511900000003", "Carla"),
    ];
    for (n, (phone, name)) in people.iter().enumerate() {
        f.tick(86_400);
        let (id, jid) = (format!("IN{n}"), format!("{phone}@s.whatsapp.net"));
        let incoming = Incoming {
            id: &id,
            jid: &jid,
            name,
            ..Default::default()
        };
        f.incoming(&session.id, incoming);
    }
    admin
        .post("/conversations/2/toggle_priority", json!({ "priority": "urgent" }))
        .await;
    admin.post("/labels", json!({ "title": "vip" })).await;
    admin
        .post("/conversations/1/labels", json!({ "labels": ["vip"] }))
        .await;
    admin
}
