//! Contact book: creating contacts, starting conversations, notes, labels, blocking and avatars.
mod common;

use common::{Fixture, Incoming};
use serde_json::{json, Value};

#[tokio::test]
async fn agents_create_contacts_and_start_whatsapp_conversations() {
    let f = Fixture::new().await;
    let session = f.session("Suporte");
    let admin = f.bootstrap().await;
    let maria = f.agent(&admin, "maria@example.com", "agent", true).await;
    let outsider = f.agent(&admin, "fora@example.com", "agent", false).await;
    let body = json!({ "name": "Ana", "phone_number": "+55 (11) 98888-0001", "email": "ana@example.com" });
    let ana = maria.post("/contacts", body).await;
    assert_eq!(ana.status, 201);
    assert_eq!(ana.body["phone_number"], "+5511988880001");
    assert_eq!(ana.body["email"], "ana@example.com");
    assert!(f.event_names().contains(&"contact.created".to_string()));
    let duplicate = maria
        .post("/contacts", json!({ "phone_number": "5511988880001" }))
        .await;
    assert_eq!(duplicate.status, 422);
    for bad in [json!({ "phone_number": "12ab" }), json!({ "email": "nope" }), json!({})] {
        assert_eq!(maria.post("/contacts", bad.clone()).await.status, 400, "{bad}");
    }
    let inbox = maria.get("/inboxes").await.body[0]["id"].as_i64().unwrap();
    let start = json!({ "contact_id": ana.body["id"], "inbox_id": inbox, "message": { "content": "Olá Ana!" } });
    let conversation = maria.post("/conversations", start.clone()).await;
    assert_eq!(conversation.status, 201);
    assert_eq!(conversation.body["contact_jid"], "5511988880001@s.whatsapp.net");
    assert_eq!(conversation.body["assignee_id"], maria.id());
    let sent = f.wa.sent();
    assert_eq!(
        (sent[0].session_id.as_str(), sent[0].jid.as_str(), sent[0].text.as_str()),
        (
            session.id.as_str(),
            "5511988880001@s.whatsapp.net",
            "*maria*:\nOlá Ana!"
        )
    );
    let again = maria
        .post(
            "/conversations",
            json!({ "contact_id": ana.body["id"], "inbox_id": inbox }),
        )
        .await;
    assert_eq!(
        again.body["display_id"], conversation.body["display_id"],
        "open conversation is reused"
    );
    assert_eq!(outsider.post("/conversations", start).await.status, 403);
    let email_only = maria
        .post("/contacts", json!({ "email": "sem@telefone.com" }))
        .await
        .body;
    let no_phone = json!({ "contact_id": email_only["id"], "inbox_id": inbox });
    assert_eq!(maria.post("/conversations", no_phone).await.status, 422);
    let missing = json!({ "contact_id": ana.body["id"], "inbox_id": 999 });
    assert_eq!(maria.post("/conversations", missing).await.status, 404);
    let id = ana.body["id"].as_i64().unwrap();
    let taken = maria
        .patch(
            &format!("/contacts/{}", email_only["id"]),
            json!({ "phone_number": "+5511988880001" }),
        )
        .await;
    assert_eq!(taken.status, 422);
    let moved = maria
        .patch(&format!("/contacts/{id}"), json!({ "phone_number": "+5511988880009" }))
        .await;
    assert_eq!(moved.body["phone_number"], "+5511988880009");
}

#[tokio::test]
async fn notes_labels_avatar_and_blocking() {
    let f = Fixture::new().await;
    let session = f.session("Suporte");
    let admin = f.bootstrap().await;
    let maria = f.agent(&admin, "maria@example.com", "agent", true).await;
    let jose = f.agent(&admin, "jose@example.com", "agent", true).await;
    f.incoming(&session.id, Incoming::default());
    let note = maria
        .post("/contacts/1/notes", json!({ "content": "Prefere ligação à tarde" }))
        .await;
    assert_eq!(note.status, 201);
    let notes = jose.get("/contacts/1/notes").await.body;
    assert_eq!(
        (notes[0]["content"].as_str(), notes[0]["user_name"].as_str()),
        (Some("Prefere ligação à tarde"), Some("maria"))
    );
    let path = format!("/contacts/1/notes/{}", note.body["id"]);
    assert_eq!(jose.del(&path, None).await.status, 403);
    assert_eq!(
        admin
            .del(&format!("/contacts/2/notes/{}", note.body["id"]), None)
            .await
            .status,
        404
    );
    assert_eq!(maria.del(&path, None).await.status, 200);
    assert!(maria.get("/contacts/1/notes").await.body.as_array().unwrap().is_empty());
    assert_eq!(maria.get("/contacts/99/notes").await.status, 404);

    admin.post("/labels", json!({ "title": "cliente" })).await;
    let labelled = maria.post("/contacts/1/labels", json!({ "labels": ["cliente"] })).await;
    assert_eq!(labelled.body["labels"], json!(["cliente"]));
    assert_eq!(
        maria
            .post("/contacts/1/labels", json!({ "labels": ["fantasma"] }))
            .await
            .status,
        422
    );
    let filter = json!({ "payload": [{ "attribute_key": "labels", "filter_operator": "equal_to", "values": ["cliente"], "query_operator": "and" }] });
    assert_eq!(
        maria
            .post("/contacts/filter", filter)
            .await
            .body
            .as_array()
            .unwrap()
            .len(),
        1
    );

    f.wa.avatars.lock().insert(
        "5511988887777@s.whatsapp.net".into(),
        "https://pps.whatsapp.net/a.jpg".into(),
    );
    let avatar = maria.post("/contacts/1/avatar", json!({})).await.body;
    assert_eq!(avatar["avatar_url"], "https://pps.whatsapp.net/a.jpg");

    let blocked = maria.patch("/contacts/1", json!({ "blocked": true })).await.body;
    assert_eq!(blocked["blocked"], 1);
    assert!(f
        .wa
        .actions()
        .contains(&"block 5511988887777@s.whatsapp.net true".to_string()));
    let before = maria
        .get("/conversations/1/messages")
        .await
        .body
        .as_array()
        .unwrap()
        .len();
    f.incoming(
        &session.id,
        Incoming {
            id: "IN2",
            body: "spam",
            ..Default::default()
        },
    );
    assert_eq!(
        maria
            .get("/conversations/1/messages")
            .await
            .body
            .as_array()
            .unwrap()
            .len(),
        before
    );
    f.wa.fail_with(Some("offline"));
    let unblocked = maria.patch("/contacts/1", json!({ "blocked": false })).await;
    assert_eq!(
        unblocked.body["blocked"], 0,
        "WhatsApp failures do not undo the local change"
    );
}

#[tokio::test]
async fn merging_and_deleting_contacts() {
    let f = Fixture::new().await;
    let session = f.session("Suporte");
    let admin = f.bootstrap().await;
    let maria = f.agent(&admin, "maria@example.com", "agent", true).await;
    f.incoming(
        &session.id,
        Incoming {
            name: "Cliente WhatsApp",
            ..Default::default()
        },
    );
    let lid = Incoming {
        id: "IN2",
        jid: "123456789@lid",
        name: "Duplicado",
        ..Default::default()
    };
    f.incoming(&session.id, lid);
    maria
        .patch(
            "/contacts/2",
            json!({ "email": "dup@example.com", "custom_attributes": { "origem": "lid", "plano": "x" } }),
        )
        .await;
    maria
        .patch("/contacts/1", json!({ "custom_attributes": { "plano": "pro" } }))
        .await;
    maria
        .post("/contacts/2/notes", json!({ "content": "nota do duplicado" }))
        .await;
    let merge = |base: i64, mergee: i64| json!({ "base_contact_id": base, "mergee_contact_id": mergee });
    assert_eq!(maria.post("/actions/contact_merge", merge(1, 1)).await.status, 400);
    assert_eq!(maria.post("/actions/contact_merge", merge(1, 99)).await.status, 404);
    let merged = maria.post("/actions/contact_merge", merge(1, 2)).await.body;
    assert_eq!(merged["email"], "dup@example.com");
    assert_eq!(merged["name"], "Cliente WhatsApp");
    assert_eq!(merged["custom_attributes"], json!({ "origem": "lid", "plano": "pro" }));
    assert_eq!(maria.get("/contacts/2").await.status, 404);
    let detail = maria.get("/contacts/1").await.body;
    assert_eq!(detail["conversations"].as_array().unwrap().len(), 2);
    assert_eq!(maria.get("/contacts/1/notes").await.body.as_array().unwrap().len(), 1);
    assert!(f.event_names().contains(&"contact.deleted".to_string()));

    assert_eq!(maria.del("/contacts/1", None).await.status, 403);
    assert_eq!(admin.del("/contacts/1", None).await.status, 200);
    assert_eq!(admin.get("/contacts/1").await.status, 404);
    let left: Value = admin.get("/conversations?status=all").await.body;
    assert!(left.as_array().unwrap().is_empty(), "conversations go with the contact");
    assert_eq!(admin.del("/contacts/1", None).await.status, 404);
}
