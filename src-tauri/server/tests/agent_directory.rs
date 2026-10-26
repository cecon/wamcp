//! Agent roster: human and AI agents, roles, skills (SKILL.md import) and encrypted credentials.
mod common;

use common::Fixture;
use serde_json::{json, Value};
use wamcp_server::adapters::outbound::secret_box::AesSecretBox;
use wamcp_server::application::ports::SecretBox;
use wamcp_server::domain::agents::parse_skill_md;

fn ai(name: &str, role: &str) -> Value {
    json!({ "name": name, "kind": "ai", "role": role, "runtime": "claude_cli", "model": "sonnet",
            "instructions": "Atenda com cordialidade." })
}

#[tokio::test]
async fn admins_register_human_and_ai_agents_with_role_rules() {
    let f = Fixture::new().await;
    let admin = f.bootstrap().await;
    let maria = f.agent(&admin, "maria@example.com", "agent", false).await;
    assert_eq!(maria.get("/agent_directory").await.status, 403);

    let human = json!({ "name": "Ana (financeiro)", "kind": "human", "role": "operator",
                        "whatsapp": "+55 (11) 98888-7777" });
    let ana = admin.post("/agent_directory", human).await;
    assert_eq!(ana.status, 201, "{:?}", ana.body);
    assert_eq!(ana.body["whatsapp_jid"], "5511988887777@s.whatsapp.net");
    assert_eq!(ana.body["skill_ids"], json!([]));
    let cases = [
        (
            json!({ "name": "Sem contato", "kind": "human", "role": "operator" }),
            "sem WhatsApp nem login",
        ),
        (
            json!({ "name": "X", "kind": "human", "role": "qa", "whatsapp": "123" }),
            "WhatsApp curto",
        ),
        (
            json!({ "name": "X", "kind": "human", "role": "qa", "whatsapp": "5511988887777", "runtime": "claude_cli" }),
            "humano com runtime",
        ),
        (
            json!({ "name": "X", "kind": "ai", "role": "operator", "runtime": "gpt-magic" }),
            "runtime inválido",
        ),
        (
            json!({ "name": "X", "kind": "ai", "role": "chefe", "runtime": "claude_cli" }),
            "função inválida",
        ),
        (json!({ "name": "X", "kind": "robot", "role": "qa" }), "tipo inválido"),
    ];
    for (body, why) in cases {
        assert_eq!(admin.post("/agent_directory", body).await.status, 400, "{why}");
    }
    let login = json!({ "name": "Maria", "kind": "human", "role": "qa", "user_id": maria.user["id"] });
    let linked = admin.post("/agent_directory", login).await.body;
    assert_eq!(linked["user_name"], "maria");

    let coordinator = admin
        .post("/agent_directory", ai("Coordenadora", "coordinator"))
        .await
        .body;
    let operator = admin
        .post("/agent_directory", ai("Operador de pedidos", "operator"))
        .await
        .body;
    assert_eq!(
        (operator["runtime"].as_str(), operator["active"].as_bool()),
        (Some("claude_cli"), Some(true))
    );
    let list = admin.get("/agent_directory").await.body;
    assert_eq!(list.as_array().unwrap().len(), 4);

    let id = &operator["id"];
    let to_human = json!({ "name": "X", "kind": "human", "role": "operator", "whatsapp": "5511988887777" });
    assert_eq!(
        admin.put(&format!("/agent_directory/{id}"), to_human).await.status,
        400,
        "kind is fixed"
    );
    let mut renamed = ai("Operador de entregas", "dev_support");
    renamed["active"] = json!(false);
    let edited = admin.put(&format!("/agent_directory/{id}"), renamed).await.body;
    assert_eq!(
        (edited["name"].as_str(), edited["role"].as_str()),
        (Some("Operador de entregas"), Some("dev_support"))
    );
    assert_eq!(edited["active"], false);
    assert_eq!(
        admin
            .del(&format!("/agent_directory/{}", coordinator["id"]), None)
            .await
            .status,
        200
    );
    assert_eq!(
        admin
            .del(&format!("/agent_directory/{}", coordinator["id"]), None)
            .await
            .status,
        404
    );
}

#[tokio::test]
async fn skills_are_imported_and_only_executing_agents_hold_them() {
    let f = Fixture::new().await;
    let admin = f.bootstrap().await;
    let manual = json!({ "name": "Pedidos", "description": "Monta pedidos", "instructions": "Use o cardápio.",
                         "tools": ["reply_conversation", "catalog_*"] });
    let pedidos = admin.post("/skills", manual.clone()).await;
    assert_eq!(pedidos.status, 201, "{:?}", pedidos.body);
    assert_eq!(admin.post("/skills", manual).await.status, 422, "unique names");
    let bad_tools = json!({ "name": "X", "tools": ["rm -rf"] });
    assert_eq!(admin.post("/skills", bad_tools).await.status, 400);

    let md = "---\nname: Entregas\ndescription: \"Calcula frete\"\nallowed-tools:\n  - reply_conversation\n  - http_request\n---\n\n# Entregas\nConsulte a tabela de frete.\n";
    let imported = admin.post("/skills/import", json!({ "content": md })).await;
    assert_eq!(imported.status, 201, "{:?}", imported.body);
    assert_eq!(imported.body["tools"], json!(["reply_conversation", "http_request"]));
    assert!(imported.body["instructions"]
        .as_str()
        .unwrap()
        .starts_with("# Entregas"));
    let no_header = admin.post("/skills/import", json!({ "content": "só texto" })).await;
    assert_eq!(no_header.status, 400);

    let skill_ids = json!({ "skill_ids": [pedidos.body["id"], imported.body["id"]] });
    let operator = admin.post("/agent_directory", ai("Operador", "operator")).await.body;
    let path = format!("/agent_directory/{}/skills", operator["id"]);
    let with_skills = admin.put(&path, skill_ids.clone()).await;
    assert_eq!(with_skills.body["skill_ids"].as_array().unwrap().len(), 2);
    let to_coordinator = admin
        .put(
            &format!("/agent_directory/{}", operator["id"]),
            ai("Operador", "coordinator"),
        )
        .await;
    assert_eq!(to_coordinator.status, 400, "coordinators never execute");

    let coordinator = admin
        .post("/agent_directory", ai("Coordenador", "coordinator"))
        .await
        .body;
    let refused = admin
        .put(&format!("/agent_directory/{}/skills", coordinator["id"]), skill_ids)
        .await;
    assert_eq!(refused.status, 400);
    let unknown = admin.put(&path, json!({ "skill_ids": [999] })).await;
    assert_eq!(unknown.status, 404);

    assert_eq!(
        admin.del(&format!("/skills/{}", pedidos.body["id"]), None).await.status,
        200
    );
    let after = admin.get("/agent_directory").await.body;
    let operator_now = after
        .as_array()
        .unwrap()
        .iter()
        .find(|a| a["id"] == operator["id"])
        .unwrap();
    assert_eq!(
        operator_now["skill_ids"],
        json!([imported.body["id"]]),
        "deleting a skill detaches it"
    );
}

#[tokio::test]
async fn credentials_are_encrypted_and_never_returned() {
    let f = Fixture::new().await;
    let admin = f.bootstrap().await;
    let operator = admin.post("/agent_directory", ai("Operador", "operator")).await.body;
    let path = format!("/agent_directory/{}/credentials", operator["id"]);
    let secret = "sk-live-super-secreto-123";
    let body = json!({ "name": "erp_api", "kind": "api_key", "secret": secret });
    let created = admin.post(&path, body.clone()).await;
    assert_eq!(created.status, 201, "{:?}", created.body);
    assert!(created.body.get("secret").is_none());
    assert_eq!(admin.post(&path, body).await.status, 422, "unique per agent");
    let invalid = json!({ "name": "com espaço", "kind": "api_key", "secret": "x" });
    assert_eq!(admin.post(&path, invalid).await.status, 400);
    let listed = admin.get(&path).await;
    assert_eq!(listed.body[0]["name"], "erp_api");
    assert!(!listed.text.contains(secret), "listings never carry the secret");
    let roster = admin.get("/agent_directory").await;
    assert_eq!(roster.body[0]["credential_count"], 1);
    assert!(!roster.text.contains(secret));

    let stored = f
        .store
        .scalar(
            "SELECT COUNT(*) FROM agent_credentials WHERE secret LIKE 'v1:%' AND instr(secret, ?)=0",
            vec![rusqlite::types::Value::Text(secret.into())],
        )
        .unwrap();
    assert_eq!(stored, Some(1), "encrypted at rest");

    let coordinator = admin
        .post("/agent_directory", ai("Coordenador", "coordinator"))
        .await
        .body;
    let refused = json!({ "name": "token", "kind": "bearer", "secret": "x" });
    let coordinator_path = format!("/agent_directory/{}/credentials", coordinator["id"]);
    assert_eq!(admin.post(&coordinator_path, refused).await.status, 400);

    let id = created.body["id"].as_i64().unwrap();
    assert_eq!(admin.del(&format!("{path}/{id}"), None).await.status, 200);
    assert_eq!(admin.del(&format!("{path}/{id}"), None).await.status, 404);
}

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
