//! Profiles carry skills that every agent of the profile inherits; the app ships the
//! "Atendente de delivery" skill and a profile of the same name with it.
mod agents_support;
mod common;

use agents_support::{ai, profiles};
use common::Fixture;
use serde_json::{json, Value};

fn by_name<'a>(list: &'a Value, name: &str) -> &'a Value {
    list.as_array().unwrap().iter().find(|s| s["name"] == name).unwrap()
}

#[tokio::test]
async fn the_delivery_profile_ships_with_the_delivery_skill() {
    let f = Fixture::new().await;
    let admin = f.bootstrap().await;
    let p = profiles(&admin).await;
    let skills = admin.get("/skills").await.body;
    let delivery = by_name(&skills, "Atendente de delivery");
    let tools = delivery["tools"].as_array().unwrap();
    for tool in [
        "reply_conversation",
        "catalog_search",
        "catalog_item",
        "catalog_quote",
        "set_conversation_status",
    ] {
        assert!(tools.contains(&json!(tool)), "{tool}");
    }
    let instructions = delivery["instructions"].as_str().unwrap();
    assert!(instructions.contains("## Fechar a venda") && instructions.contains("forma de pagamento"));

    let roles = admin.get("/custom_roles").await.body;
    let profile = by_name(&roles, "Atendente de delivery");
    assert_eq!(profile["id"], p.delivery);
    assert_eq!(profile["agent_role"], "operator");
    assert_eq!(profile["skill_ids"], json!([delivery["id"]]));

    // An AI agent of the profile inherits the skill, on top of its own (none here).
    let mut body = ai(&p, "Ana", "operator");
    body["profile_id"] = json!(p.delivery);
    let agent = admin.post("/agent_directory", body).await.body;
    assert_eq!(
        (agent["skill_ids"].clone(), agent["profile_skill_ids"].clone()),
        (json!([]), json!([delivery["id"]]))
    );
    assert_eq!(agent["role"], "operator");
}

#[tokio::test]
async fn only_profiles_that_execute_carry_skills() {
    let f = Fixture::new().await;
    let admin = f.bootstrap().await;
    let p = profiles(&admin).await;
    let skills = admin.get("/skills").await.body;
    let catalog = by_name(&skills, "Atender pelo cardápio")["id"].clone();
    let handoff = by_name(&skills, "Transferir para a equipe")["id"].clone();
    let base = json!({ "name": "Vendas", "permissions": ["conversation_manage"], "agent_role": "operator" });

    let mut body = base.clone();
    body["skill_ids"] = json!([catalog, handoff, catalog]);
    let created = admin.post("/custom_roles", body).await;
    assert_eq!(created.status, 201, "{:?}", created.body);
    let id = created.body["id"].clone();
    let mut sorted = vec![catalog.as_i64().unwrap(), handoff.as_i64().unwrap()];
    sorted.sort_unstable();
    assert_eq!(created.body["skill_ids"], json!(sorted));

    // Omitting skill_ids keeps them; an empty list clears them.
    let mut renamed = base.clone();
    renamed["name"] = json!("Vendas balcão");
    let kept = admin.put(&format!("/custom_roles/{id}"), renamed.clone()).await.body;
    assert_eq!(kept["skill_ids"].as_array().unwrap().len(), 2);
    let mut coordinator = renamed.clone();
    coordinator["agent_role"] = json!("coordinator");
    let refused = admin.put(&format!("/custom_roles/{id}"), coordinator.clone()).await;
    assert_eq!(refused.status, 400, "coordinators only delegate");
    coordinator["skill_ids"] = json!([]);
    let cleared = admin.put(&format!("/custom_roles/{id}"), coordinator).await;
    assert_eq!(cleared.status, 200, "{:?}", cleared.body);
    assert_eq!(cleared.body["skill_ids"], json!([]));

    let mut unknown = base;
    unknown["name"] = json!("Outro");
    unknown["skill_ids"] = json!([9999]);
    assert_eq!(admin.post("/custom_roles", unknown).await.status, 422);

    // Deleting a skill unlinks it from the profiles.
    let delivery = by_name(&skills, "Atendente de delivery")["id"].clone();
    assert_eq!(admin.del(&format!("/skills/{delivery}"), None).await.status, 200);
    let roles = admin.get("/custom_roles").await.body;
    let profile = roles
        .as_array()
        .unwrap()
        .iter()
        .find(|r| r["id"] == p.delivery)
        .unwrap();
    assert_eq!(profile["skill_ids"], json!([]));
}

#[test]
fn answers_use_the_agent_and_profile_skills() {
    use wamcp_server::domain::llm::agent_instructions;
    use wamcp_server::domain::model::{RosterAgent, Skill};
    let skill = |id: i64, name: &str| Skill {
        id,
        name: name.into(),
        instructions: format!("Faça {name}."),
        ..Default::default()
    };
    let agent: RosterAgent = serde_json::from_value(json!({
        "id": 1, "name": "Ana", "kind": "ai", "role": "operator", "profile_id": 2, "profile_name": "Vendas",
        "description": null, "user_id": null, "user_name": null, "user_email": null, "whatsapp_jid": null,
        "runtime": "claude_cli", "model": null, "instructions": "Seja breve.", "active": true,
        "skill_ids": [1], "profile_skill_ids": [2], "credential_count": 0, "created": ""
    }))
    .unwrap();
    let text = agent_instructions(&agent, &[skill(1, "própria"), skill(2, "do perfil"), skill(3, "outra")]);
    assert_eq!(
        text,
        "Seja breve.\n\nSkill \"própria\":\nFaça própria.\n\nSkill \"do perfil\":\nFaça do perfil."
    );
}
