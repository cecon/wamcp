//! Profiles carry skills that every agent of the profile inherits, on top of the agent's own.
mod agents_support;
mod common;

use agents_support::{ai, profiles};
use common::Fixture;
use serde_json::{json, Value};

fn by_name<'a>(list: &'a Value, name: &str) -> &'a Value {
    list.as_array().unwrap().iter().find(|s| s["name"] == name).unwrap()
}

#[tokio::test]
async fn agents_inherit_the_skills_of_their_profile() {
    let f = Fixture::new().await;
    let admin = f.bootstrap().await;
    let p = profiles(&admin).await;
    // No catalog or sales seeds: no delivery profile and no sales skills.
    let roles = admin.get("/custom_roles").await.body;
    assert!(roles
        .as_array()
        .unwrap()
        .iter()
        .all(|r| r["name"] != "Atendente de delivery"));
    for role in roles.as_array().unwrap() {
        assert_eq!(role["skill_ids"], json!([]), "{}", role["name"]);
    }

    let skill = json!({ "name": "Cobranças", "instructions": "Cobre com educação.", "tools": ["reply_conversation"] });
    let billing = admin.post("/skills", skill).await.body["id"].clone();
    let profile = json!({ "name": "Financeiro", "permissions": ["conversation_manage"], "agent_role": "operator",
                          "skill_ids": [billing] });
    let finance = admin.post("/custom_roles", profile).await.body["id"].clone();

    // An AI agent of the profile inherits the skill, on top of its own (none here).
    let mut body = ai(&p, "Anny", "operator");
    body["profile_id"] = finance;
    let agent = admin.post("/agent_directory", body).await.body;
    assert_eq!(
        (agent["skill_ids"].clone(), agent["profile_skill_ids"].clone()),
        (json!([]), json!([billing]))
    );
    assert_eq!(agent["role"], "operator");
}

#[tokio::test]
async fn only_profiles_that_execute_carry_skills() {
    let f = Fixture::new().await;
    let admin = f.bootstrap().await;
    let new_skill = |name: &str| json!({ "name": name, "instructions": "Faça." });
    let billing = admin.post("/skills", new_skill("Cobranças")).await.body["id"].clone();
    let reports = admin.post("/skills", new_skill("Relatórios")).await.body["id"].clone();
    let base = json!({ "name": "Vendas", "permissions": ["conversation_manage"], "agent_role": "operator" });

    let mut body = base.clone();
    body["skill_ids"] = json!([reports, billing, reports]);
    let created = admin.post("/custom_roles", body).await;
    assert_eq!(created.status, 201, "{:?}", created.body);
    let id = created.body["id"].clone();
    let mut sorted = vec![billing.as_i64().unwrap(), reports.as_i64().unwrap()];
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

    let mut unknown = base.clone();
    unknown["name"] = json!("Outro");
    unknown["skill_ids"] = json!([9999]);
    assert_eq!(admin.post("/custom_roles", unknown).await.status, 422);

    // Deleting a skill unlinks it from the profiles.
    let mut linked = base;
    linked["name"] = json!("Financeiro");
    linked["skill_ids"] = json!([billing]);
    let finance = admin.post("/custom_roles", linked).await.body["id"].clone();
    assert_eq!(admin.del(&format!("/skills/{billing}"), None).await.status, 200);
    let roles = admin.get("/custom_roles").await.body;
    assert_eq!(by_name(&roles, "Financeiro")["id"], finance);
    assert_eq!(by_name(&roles, "Financeiro")["skill_ids"], json!([]));
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
