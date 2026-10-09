//! Helpers shared by the helpdesk phase 2 tests.
#![allow(dead_code)]
use crate::common::{Agent, Fixture, PASSWORD};
use serde_json::{json, Value};

/// Creates an agent (default role) in the given inboxes and logs in as them.
pub async fn agent(f: &Fixture, admin: &Agent, email: &str, inbox_ids: Value) -> Agent {
    let name = email.split('@').next().unwrap_or(email);
    admin
        .post(
            "/agents",
            json!({ "name": name, "email": email, "password": PASSWORD, "inbox_ids": inbox_ids }),
        )
        .await;
    f.login(email, PASSWORD).await.expect("agent login")
}

pub fn items(value: &Value) -> &Vec<Value> {
    value.as_array().expect("array")
}
