//! Shared helpers for the agent roster tests: the seeded profiles and an AI agent body.
#![allow(dead_code)]
use super::common;
use serde_json::{json, Value};

/// The seeded profiles: the built-in "Padrão" and one per AI role.
pub struct Profiles {
    pub builtin: i64,
    pub roles: Vec<(String, i64)>,
}

impl Profiles {
    pub fn of(&self, role: &str) -> i64 {
        self.roles.iter().find(|(r, _)| r == role).map(|(_, id)| *id).unwrap()
    }
}

pub async fn profiles(admin: &common::Agent) -> Profiles {
    let list = admin.get("/custom_roles").await.body;
    let list = list.as_array().unwrap();
    let builtin = list.iter().find(|r| r["builtin"] == true).unwrap()["id"]
        .as_i64()
        .unwrap();
    let roles = list
        .iter()
        .filter_map(|r| Some((r["agent_role"].as_str()?.to_string(), r["id"].as_i64()?)))
        .collect();
    Profiles { builtin, roles }
}

pub fn ai(p: &Profiles, name: &str, role: &str) -> Value {
    json!({ "name": name, "kind": "ai", "profile_id": p.of(role), "runtime": "claude_cli", "model": "sonnet",
            "instructions": "Atenda com cordialidade." })
}
