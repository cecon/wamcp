//! Mandatory profiles carrying the AI role, default skills, the secret box and SKILL.md parsing.
mod agents_support;
mod common;

use agents_support::{ai, profiles};
use common::Fixture;
use serde_json::json;
use wamcp_server::adapters::outbound::secret_box::AesSecretBox;
use wamcp_server::application::ports::SecretBox;
use wamcp_server::domain::agents::parse_skill_md;

#[test]
fn secret_box_round_trips_and_detects_tampering() {
    let vault = AesSecretBox::generated();
    let sealed = vault.seal("senha do ERP").unwrap();
    assert!(sealed.starts_with("v1:") && !sealed.contains("senha"));
    assert_ne!(sealed, vault.seal("senha do ERP").unwrap(), "random nonce per secret");
    assert_eq!(vault.open(&sealed).unwrap(), "senha do ERP");
    assert!(
        AesSecretBox::generated().open(&sealed).is_err(),
        "another key cannot open it"
    );
    let mut tampered = sealed.clone();
    tampered.pop();
    tampered.push(if sealed.ends_with('A') { 'B' } else { 'A' });
    assert!(vault.open(&tampered).is_err());

    let dir = tempfile::tempdir().unwrap();
    let key = dir.path().join("agents.key");
    let first = AesSecretBox::from_file(&key).unwrap().seal("x").unwrap();
    assert_eq!(
        AesSecretBox::from_file(&key).unwrap().open(&first).unwrap(),
        "x",
        "the key file is reused"
    );
}

#[test]
fn skill_md_front_matter_forms() {
    let inline = parse_skill_md("---\nname: 'Suporte'\ndescription: Ajuda\nallowed-tools: a, b_*\n---\nCorpo").unwrap();
    assert_eq!(
        (inline.name.as_str(), inline.tools.clone()),
        ("Suporte", vec!["a".to_string(), "b_*".into()])
    );
    assert_eq!(inline.instructions, "Corpo");
    assert_eq!(inline.description.as_deref(), Some("Ajuda"));
    assert!(
        parse_skill_md("---\ndescription: x\n---\ncorpo").is_err(),
        "name is required"
    );
    assert!(parse_skill_md("---\nname: x\nsem fechamento").is_err());
    let windows = parse_skill_md("\u{feff}---\r\nname: Win\r\n---\r\nTexto\r\n").unwrap();
    assert_eq!((windows.name.as_str(), windows.instructions.as_str()), ("Win", "Texto"));
}

#[tokio::test]
async fn default_skills_ship_with_real_mcp_tools() {
    let f = Fixture::new().await;
    let admin = f.bootstrap().await;
    let skills = admin.get("/skills").await.body;
    let names: Vec<&str> = skills
        .as_array()
        .unwrap()
        .iter()
        .map(|s| s["name"].as_str().unwrap())
        .collect();
    for expected in [
        "Atender pelo cardápio",
        "Montar e fechar pedido",
        "Transferir para a equipe",
    ] {
        assert!(names.contains(&expected), "{expected} in {names:?}");
    }
    let real: Vec<&str> = wamcp_server::adapters::inbound::mcp::catalog::tools()
        .iter()
        .map(|t| t.name)
        .collect();
    for skill in skills.as_array().unwrap() {
        assert!(!skill["instructions"].as_str().unwrap().is_empty());
        for tool in skill["tools"].as_array().unwrap() {
            assert!(real.contains(&tool.as_str().unwrap()), "{tool} is not an MCP tool");
        }
    }
    let catalog = skills
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["name"] == "Atender pelo cardápio")
        .unwrap();
    assert!(catalog["tools"].as_array().unwrap().contains(&json!("catalog_search")));
}

#[tokio::test]
async fn every_agent_has_a_profile_that_carries_the_ai_role() {
    let f = Fixture::new().await;
    let admin = f.bootstrap().await;
    let p = profiles(&admin).await;
    assert_eq!(p.roles.len(), 4, "one seeded profile per AI role");
    let maria = f.agent(&admin, "maria@example.com", "agent", false).await;
    let maria_id = maria.user["id"].as_i64().unwrap();
    let users = admin.get("/agents").await.body;
    assert!(
        users
            .as_array()
            .unwrap()
            .iter()
            .all(|u| u["custom_role_id"] == p.builtin),
        "new logins get Padrão: {users}"
    );
    let cleared = admin
        .patch(&format!("/agents/{maria_id}"), json!({ "custom_role_id": null }))
        .await;
    assert_eq!(cleared.status, 400, "the profile is mandatory");
    assert_eq!(
        admin.del(&format!("/custom_roles/{}", p.builtin), None).await.status,
        409
    );

    // The AI role of an agent follows its profile.
    let operator = admin
        .post("/agent_directory", ai(&p, "Operador", "operator"))
        .await
        .body;
    let skill = admin.post("/skills", json!({ "name": "Pedidos" })).await.body;
    let path = format!("/agent_directory/{}/skills", operator["id"]);
    admin.put(&path, json!({ "skill_ids": [skill["id"]] })).await;
    let profile =
        |role: Option<&str>| json!({ "name": "Operador", "permissions": ["conversation_manage"], "agent_role": role });
    let operator_profile = format!("/custom_roles/{}", p.of("operator"));
    let to_coordinator = admin.put(&operator_profile, profile(Some("coordinator"))).await;
    assert_eq!(
        to_coordinator.status, 400,
        "it has skills and coordinators never execute"
    );
    assert_eq!(
        admin.put(&operator_profile, profile(None)).await.status,
        400,
        "AI agents keep an AI role"
    );
    assert_eq!(
        admin.put(&operator_profile, profile(Some("dev_support"))).await.status,
        200
    );
    let roster = admin.get("/agent_directory").await.body;
    let row = roster
        .as_array()
        .unwrap()
        .iter()
        .find(|a| a["id"] == operator["id"])
        .unwrap();
    assert_eq!(row["role"], "dev_support");
    assert_eq!(
        admin.del(&operator_profile, None).await.status,
        409,
        "an AI agent uses it"
    );

    // Deleting a profile moves its users and people back to Padrão.
    let custom = admin
        .post(
            "/custom_roles",
            json!({ "name": "Só contatos", "permissions": ["contact_manage"] }),
        )
        .await
        .body;
    admin
        .patch(
            &format!("/agents/{maria_id}"),
            json!({ "custom_role_id": custom["id"] }),
        )
        .await;
    assert_eq!(
        admin.del(&format!("/custom_roles/{}", custom["id"]), None).await.status,
        200
    );
    let maria_now = admin.get("/agents").await.body;
    let maria_now = maria_now
        .as_array()
        .unwrap()
        .iter()
        .find(|u| u["id"] == maria_id)
        .unwrap();
    assert_eq!(maria_now["custom_role_id"], p.builtin);
}

#[tokio::test]
async fn people_and_ai_share_roles_and_logins_live_in_the_same_list() {
    let f = Fixture::new().await;
    let admin = f.bootstrap().await;
    let p = profiles(&admin).await;
    let maria = f.agent(&admin, "maria@example.com", "agent", false).await;
    let roster = admin.get("/agent_directory").await.body;
    let person = |name: &str| {
        roster
            .as_array()
            .unwrap()
            .iter()
            .find(|a| a["name"] == name)
            .cloned()
            .unwrap()
    };
    let (admin_row, maria_row) = (person("Admin"), person("maria"));
    assert_eq!(admin_row["user_email"], "admin@example.com");

    // A person with an executing role holds skills, like an AI operator; credentials stay AI-only.
    let skill = admin.post("/skills", json!({ "name": "Aprovar descontos" })).await.body;
    let skills = format!("/agent_directory/{}/skills", maria_row["id"]);
    assert_eq!(
        admin.put(&skills, json!({ "skill_ids": [skill["id"]] })).await.status,
        400,
        "Padrão has no role"
    );
    let as_operator =
        json!({ "name": "Maria", "kind": "human", "profile_id": p.of("operator"), "user_id": maria.user["id"] });
    admin
        .put(&format!("/agent_directory/{}", maria_row["id"]), as_operator)
        .await;
    assert_eq!(
        admin.put(&skills, json!({ "skill_ids": [skill["id"]] })).await.status,
        200
    );
    let credential = json!({ "name": "token", "kind": "bearer", "secret": "x" });
    let credentials = format!("/agent_directory/{}/credentials", maria_row["id"]);
    assert_eq!(admin.post(&credentials, credential).await.status, 400);

    // Removing a person with a login removes the login, but never your own nor the last admin.
    let own = admin.del(&format!("/agent_directory/{}", admin_row["id"]), None).await;
    assert_eq!(own.status, 409);
    assert_eq!(
        admin
            .del(&format!("/agent_directory/{}", maria_row["id"]), None)
            .await
            .status,
        200
    );
    let users = admin.get("/agents").await.body;
    assert!(users
        .as_array()
        .unwrap()
        .iter()
        .all(|u| u["email"] != "maria@example.com"));
    assert!(f.login("maria@example.com", common::PASSWORD).await.is_err());

    // Deleting only the login keeps a person who has a WhatsApp.
    let jose = f.agent(&admin, "jose@example.com", "agent", false).await;
    let with_phone = json!({ "name": "José", "kind": "human", "profile_id": p.builtin, "user_id": jose.user["id"],
                             "whatsapp": "5511955554444" });
    let jose_row = admin.post("/agent_directory", with_phone).await.body;
    assert_eq!(
        admin.del(&format!("/agents/{}", jose.user["id"]), None).await.status,
        200
    );
    let after = admin.get("/agent_directory").await.body;
    let kept = after
        .as_array()
        .unwrap()
        .iter()
        .find(|a| a["id"] == jose_row["id"])
        .unwrap();
    assert_eq!(
        (kept["user_id"].is_null(), kept["whatsapp_jid"].as_str()),
        (true, Some("5511955554444@s.whatsapp.net"))
    );
}
