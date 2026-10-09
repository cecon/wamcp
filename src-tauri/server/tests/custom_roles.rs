//! Custom roles: permission sets that limit conversations, contacts and reports for agents.
mod common;

use common::{Agent, Fixture, Incoming};
use serde_json::{json, Value};

fn displays(list: &Value) -> Vec<i64> {
    let mut ids: Vec<i64> = list
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|c| c["display_id"].as_i64())
        .collect();
    ids.sort_unstable();
    ids
}

async fn visible(agent: &Agent) -> Vec<i64> {
    displays(&agent.get("/conversations?status=all").await.body)
}

#[tokio::test]
async fn roles_limit_what_agents_can_reach() {
    let f = Fixture::new().await;
    let session = f.session("Suporte");
    let admin = f.bootstrap().await;
    let maria = f.agent(&admin, "maria@example.com", "agent", true).await;
    let jose = f.agent(&admin, "jose@example.com", "agent", true).await;
    for n in 1..=4 {
        let (id, jid) = (format!("IN{n}"), format!("551190000000{n}@s.whatsapp.net"));
        f.incoming(
            &session.id,
            Incoming {
                id: &id,
                jid: &jid,
                ..Default::default()
            },
        );
    }
    let assign = |display: i64, user: i64| {
        let admin = &admin;
        async move {
            admin
                .post(
                    &format!("/conversations/{display}/assignments"),
                    json!({ "assignee_id": user }),
                )
                .await
        }
    };
    assign(2, maria.id()).await;
    assign(3, admin.id()).await;
    assign(4, jose.id()).await;
    admin
        .patch(
            "/conversations/4/participants",
            json!({ "user_ids": [jose.id(), maria.id()] }),
        )
        .await;

    let triage = json!({ "name": "Triagem", "permissions": ["conversation_unassigned_manage"] });
    assert_eq!(maria.post("/custom_roles", triage.clone()).await.status, 403);
    let role = admin.post("/custom_roles", triage.clone()).await.body;
    assert_eq!(admin.post("/custom_roles", triage).await.status, 422);
    for bad in [
        json!({ "name": "x", "permissions": ["root"] }),
        json!({ "name": "y", "permissions": [] }),
    ] {
        assert_eq!(admin.post("/custom_roles", bad.clone()).await.status, 400, "{bad}");
    }
    assert_eq!(
        visible(&maria).await,
        vec![1, 2, 3, 4],
        "no role: every conversation of the inbox"
    );
    let path = format!("/agents/{}", maria.id());
    assert_eq!(admin.patch(&path, json!({ "custom_role_id": 999 })).await.status, 404);
    let assigned = admin.patch(&path, json!({ "custom_role_id": role["id"] })).await.body;
    assert_eq!(assigned["custom_role_id"], role["id"]);

    assert_eq!(visible(&maria).await, vec![1, 2], "unassigned and mine");
    assert_eq!(maria.get("/conversations/meta?status=all").await.body["all"], 2);
    assert_eq!(maria.get("/conversations/3").await.status, 404);
    let filter =
        json!({ "payload": [{ "attribute_key": "status", "filter_operator": "equal_to", "values": ["open"] }] });
    assert_eq!(
        displays(&maria.post("/conversations/filter", filter.clone()).await.body),
        vec![1, 2]
    );
    let search = maria.get("/search?q=55119").await.body;
    assert_eq!(displays(&search["conversations"]), vec![1, 2]);
    assert!(search.get("contacts").is_none(), "no contact permission");
    assert_eq!(maria.get("/contacts").await.status, 403);
    assert_eq!(maria.get("/reports/summary_v2").await.status, 403);

    let wider = json!({ "name": "Triagem", "permissions": ["conversation_participating_manage", "report_manage", "contact_manage"] });
    let updated = admin.put(&format!("/custom_roles/{}", role["id"]), wider).await.body;
    assert_eq!(updated["permissions"].as_array().unwrap().len(), 3);
    assert_eq!(visible(&maria).await, vec![2, 4], "participating and mine");
    assert_eq!(maria.get("/reports/summary_v2").await.status, 200);
    assert_eq!(maria.get("/contacts").await.status, 200);

    let all = json!({ "name": "Supervisão", "permissions": ["conversation_manage"] });
    let supervisor = admin.post("/custom_roles", all).await.body;
    admin.patch(&path, json!({ "custom_role_id": supervisor["id"] })).await;
    assert_eq!(visible(&maria).await, vec![1, 2, 3, 4]);
    assert_eq!(maria.get("/contacts").await.status, 403, "only the listed permissions");
    assert_eq!(admin.get("/custom_roles").await.body.as_array().unwrap().len(), 2);
    assert_eq!(
        admin
            .del(&format!("/custom_roles/{}", supervisor["id"]), None)
            .await
            .status,
        200
    );
    assert_eq!(
        maria.get("/contacts").await.status,
        200,
        "back to the default agent access"
    );
    assert_eq!(maria.get("/reports/summary_v2").await.status, 403);
    assert_eq!(
        admin
            .del(&format!("/custom_roles/{}", supervisor["id"]), None)
            .await
            .status,
        404
    );
}
