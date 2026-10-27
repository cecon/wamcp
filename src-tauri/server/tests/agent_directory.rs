//! Agent roster: human and AI agents, profiles, skills and encrypted credentials.
mod agents_support;
mod common;

use agents_support::{ai, profiles};
use common::Fixture;
use serde_json::json;

#[tokio::test]
async fn admins_register_human_and_ai_agents_with_role_rules() {
    let f = Fixture::new().await;
    let admin = f.bootstrap().await;
    let p = profiles(&admin).await;
    let maria = f.agent(&admin, "maria@example.com", "agent", false).await;
    assert_eq!(maria.get("/agent_directory").await.status, 403);

    let human = json!({ "name": "Ana (financeiro)", "kind": "human", "profile_id": p.builtin,
                        "whatsapp": "+55 (11) 98888-7777" });
    let ana = admin.post("/agent_directory", human).await;
    assert_eq!(ana.status, 201, "{:?}", ana.body);
    assert_eq!(ana.body["whatsapp_jid"], "5511988887777@s.whatsapp.net");
    assert_eq!(ana.body["skill_ids"], json!([]));
    let cases = [
        (
            json!({ "name": "Sem contato", "kind": "human", "profile_id": p.builtin }),
            "sem WhatsApp nem login",
        ),
        (
            json!({ "name": "X", "kind": "human", "profile_id": p.builtin, "whatsapp": "123" }),
            "WhatsApp curto",
        ),
        (
            json!({ "name": "X", "kind": "human", "profile_id": p.builtin, "whatsapp": "5511988887777", "runtime": "claude_cli" }),
            "humano com runtime",
        ),
        (
            json!({ "name": "X", "kind": "ai", "profile_id": p.of("operator"), "runtime": "gpt-magic" }),
            "runtime inválido",
        ),
        (
            json!({ "name": "X", "kind": "ai", "profile_id": p.builtin, "runtime": "claude_cli" }),
            "IA com perfil sem função de IA",
        ),
        (
            json!({ "name": "X", "kind": "human", "whatsapp": "5511988887777" }),
            "sem perfil",
        ),
        (
            json!({ "name": "X", "kind": "robot", "profile_id": p.builtin }),
            "tipo inválido",
        ),
    ];
    for (body, why) in cases {
        assert_eq!(admin.post("/agent_directory", body).await.status, 400, "{why}");
    }
    // Every login is already a person of the list; linking it updates that person and the login.
    let roster = admin.get("/agent_directory").await.body;
    let maria_row = roster
        .as_array()
        .unwrap()
        .iter()
        .find(|a| a["user_id"] == maria.user["id"])
        .unwrap()
        .clone();
    assert_eq!(
        (maria_row["kind"].as_str(), maria_row["role"].as_str()),
        (Some("human"), None),
        "Padrão has no role"
    );
    let login = json!({ "name": "Maria", "kind": "human", "profile_id": p.of("qa"), "user_id": maria.user["id"],
                        "whatsapp": "5511977776666" });
    let linked = admin.post("/agent_directory", login).await.body;
    assert_eq!(linked["id"], maria_row["id"], "no duplicate person for a login");
    assert_eq!(
        (
            linked["user_name"].as_str(),
            linked["role"].as_str(),
            linked["user_email"].as_str()
        ),
        (Some("Maria"), Some("qa"), Some("maria@example.com"))
    );
    let users = admin.get("/agents").await.body;
    let maria_user = users
        .as_array()
        .unwrap()
        .iter()
        .find(|u| u["id"] == maria.user["id"])
        .unwrap();
    assert_eq!(maria_user["custom_role_id"], p.of("qa"), "the login takes the profile");
    let missing = json!({ "name": "X", "kind": "human", "profile_id": 999, "whatsapp": "5511988887777" });
    assert_eq!(admin.post("/agent_directory", missing).await.status, 422);

    let coordinator = admin
        .post("/agent_directory", ai(&p, "Coordenadora", "coordinator"))
        .await
        .body;
    let operator = admin
        .post("/agent_directory", ai(&p, "Operador de pedidos", "operator"))
        .await
        .body;
    assert_eq!(
        (operator["runtime"].as_str(), operator["active"].as_bool()),
        (Some("claude_cli"), Some(true))
    );
    let list = admin.get("/agent_directory").await.body;
    assert_eq!(
        list.as_array().unwrap().len(),
        5,
        "admin and Maria logins, Ana and two AI agents"
    );

    let id = &operator["id"];
    let to_human = json!({ "name": "X", "kind": "human", "profile_id": p.builtin, "whatsapp": "5511988887777" });
    assert_eq!(
        admin.put(&format!("/agent_directory/{id}"), to_human).await.status,
        400,
        "kind is fixed"
    );
    let mut renamed = ai(&p, "Operador de entregas", "dev_support");
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
    let p = profiles(&admin).await;
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
    let operator = admin
        .post("/agent_directory", ai(&p, "Operador", "operator"))
        .await
        .body;
    let path = format!("/agent_directory/{}/skills", operator["id"]);
    let with_skills = admin.put(&path, skill_ids.clone()).await;
    assert_eq!(with_skills.body["skill_ids"].as_array().unwrap().len(), 2);
    let to_coordinator = admin
        .put(
            &format!("/agent_directory/{}", operator["id"]),
            ai(&p, "Operador", "coordinator"),
        )
        .await;
    assert_eq!(to_coordinator.status, 400, "coordinators never execute");

    let coordinator = admin
        .post("/agent_directory", ai(&p, "Coordenador", "coordinator"))
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
    let p = profiles(&admin).await;
    let operator = admin
        .post("/agent_directory", ai(&p, "Operador", "operator"))
        .await
        .body;
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
    let row = roster
        .body
        .as_array()
        .unwrap()
        .iter()
        .find(|a| a["id"] == operator["id"])
        .unwrap();
    assert_eq!(row["credential_count"], 1);
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
        .post("/agent_directory", ai(&p, "Coordenador", "coordinator"))
        .await
        .body;
    let refused = json!({ "name": "token", "kind": "bearer", "secret": "x" });
    let coordinator_path = format!("/agent_directory/{}/credentials", coordinator["id"]);
    assert_eq!(admin.post(&coordinator_path, refused).await.status, 400);

    let id = created.body["id"].as_i64().unwrap();
    assert_eq!(admin.del(&format!("{path}/{id}"), None).await.status, 200);
    assert_eq!(admin.del(&format!("{path}/{id}"), None).await.status, 404);
}
