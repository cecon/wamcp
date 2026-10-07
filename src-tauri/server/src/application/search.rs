//! Global search: conversations, contacts and messages the agent may see.
use super::helpdesk::HelpdeskService;
use crate::domain::actor::Actor;
use crate::domain::error::{fail, Result};
use serde_json::{json, Value};

pub const SEARCH_TYPES: [&str; 4] = ["all", "conversations", "contacts", "messages"];
const LIMIT: i64 = 20;

impl HelpdeskService {
    pub fn search(&self, actor: &Actor, q: &str, kind: &str) -> Result<Value> {
        let q = q.trim();
        if q.chars().count() < 2 {
            return fail("Digite ao menos 2 caracteres");
        }
        let visible = self.core.visible_inbox_ids(actor)?;
        let repo = &self.core.repo;
        let wants = |name: &str| kind == "all" || kind == name;
        let mut result = json!({});
        if wants("conversations") {
            result["conversations"] = json!(repo.search_conversations(q, visible.as_deref(), LIMIT)?);
        }
        if wants("contacts") {
            result["contacts"] = json!(repo.search_contacts(q, LIMIT)?);
        }
        if wants("messages") {
            result["messages"] = json!(repo.search_messages(q, visible.as_deref(), LIMIT)?);
        }
        Ok(result)
    }
}
