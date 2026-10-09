//! Global search over conversations, contacts and messages.
mod common;

use common::{Fixture, Incoming};
use serde_json::{json, Value};

fn count(result: &Value, key: &str) -> usize {
    result[key].as_array().map_or(0, Vec::len)
}

#[tokio::test]
async fn agents_search_what_they_can_see() {
    let f = Fixture::new().await;
    let session = f.session("Suporte");
    let admin = f.bootstrap().await;
    let maria = f.agent(&admin, "maria@example.com", "agent", true).await;
    let outsider = f.agent(&admin, "fora@example.com", "agent", false).await;
    let first = Incoming {
        name: "Joana Prado",
        body: "Quero 100% de desconto no boleto",
        ..Default::default()
    };
    f.incoming(&session.id, first);
    let second = Incoming {
        id: "IN2",
        jid: "5511900000002@s.whatsapp.net",
        name: "Carlos",
        body: "Oi",
        ..Default::default()
    };
    f.incoming(&session.id, second);
    maria
        .post(
            "/conversations/1/messages",
            json!({ "content": "nota boleto", "private": true }),
        )
        .await;

    let all = maria.get("/search?q=joana").await.body;
    assert_eq!(
        (
            count(&all, "conversations"),
            count(&all, "contacts"),
            count(&all, "messages")
        ),
        (1, 1, 0)
    );
    let messages = maria.get("/search?q=boleto&type=messages").await.body;
    assert_eq!(count(&messages, "messages"), 1, "private notes are not searched");
    assert_eq!(messages["messages"][0]["display_id"], 1);
    assert_eq!(messages["messages"][0]["contact_name"], "Joana Prado");
    assert!(messages.get("contacts").is_none());
    let literal = maria.get("/search?q=100%25&type=messages").await.body;
    assert_eq!(count(&literal, "messages"), 1);
    let wildcard = maria.get("/search?q=0_d&type=messages").await.body;
    assert_eq!(count(&wildcard, "messages"), 0, "LIKE wildcards are literal");
    let by_number = maria.get("/search?q=%232&type=conversations").await.body;
    assert_eq!(by_number["conversations"][0]["contact_name"], "Carlos");
    let by_phone = maria.get("/search?q=5511900000002&type=contacts").await.body;
    assert_eq!(count(&by_phone, "contacts"), 1);

    let hidden = outsider.get("/search?q=joana").await.body;
    assert_eq!((count(&hidden, "conversations"), count(&hidden, "messages")), (0, 0));
    assert_eq!(count(&hidden, "contacts"), 1, "contacts are shared by the account");
    assert_eq!(maria.get("/search?q=a").await.status, 400);
    assert_eq!(maria.get("/search?q=joana&type=deals").await.status, 400);
}
