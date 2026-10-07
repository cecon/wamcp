//! Mirror history (port of tests/history.test.mjs): cursor pagination by (ts, id) never skips
//! messages sharing a timestamp, in the store, the admin API and the helpdesk history endpoint.
mod common;

use common::{Fixture, Incoming};
use serde_json::Value;
use std::collections::HashSet;
use wamcp_server::application::ports::{HistoryPage, MirrorRepo};
use wamcp_server::domain::model::WaMessage;

const JID: &str = "5511999999999@s.whatsapp.net";

fn text(id: String, jid: &str, ts: i64) -> WaMessage {
    WaMessage {
        body: format!("message {id}"),
        id,
        jid: jid.into(),
        alt_jid: None,
        from_me: false,
        sender: "Cliente".into(),
        push_name: None,
        kind: "conversation".into(),
        ts,
    }
}

fn fill(f: &Fixture, session_id: &str, jid: &str, count: usize, ts: i64) {
    for n in 0..count {
        f.store
            .store_message(session_id, &text(format!("{n:04}"), jid, ts), None)
            .expect("message");
    }
}

/// Follows the cursor of the oldest message of each page until a page is empty.
async fn walk<F, Fut>(mut fetch: F) -> Vec<Vec<Value>>
where
    F: FnMut(Option<(i64, String)>) -> Fut,
    Fut: std::future::Future<Output = Vec<Value>>,
{
    let mut pages = Vec::new();
    let mut cursor = None;
    loop {
        let page = fetch(cursor.clone()).await;
        let Some(oldest) = page.first() else {
            return pages;
        };
        cursor = Some((
            oldest["ts"].as_i64().expect("ts"),
            oldest["id"].as_str().expect("id").to_string(),
        ));
        pages.push(page);
        assert!(pages.len() < 10, "pagination does not terminate");
    }
}

fn ids(pages: &[Vec<Value>]) -> HashSet<String> {
    pages
        .iter()
        .flatten()
        .map(|m| m["id"].as_str().unwrap_or_default().to_string())
        .collect()
}

#[tokio::test]
async fn cursor_pagination_does_not_skip_messages_sharing_the_same_timestamp() {
    let f = Fixture::new().await;
    let session = f.session("History");
    fill(&f, &session.id, JID, 205, 100);
    let read = |before: Option<f64>, before_id: Option<String>| {
        let page = HistoryPage {
            before,
            before_id,
            limit: 100,
        };
        f.store.mirror_messages(&session.id, JID, &page).expect("page")
    };
    let first = read(None, None);
    let second = read(Some(first[0].ts as f64), Some(first[0].id.clone()));
    let third = read(Some(second[0].ts as f64), Some(second[0].id.clone()));
    assert_eq!((first.len(), second.len(), third.len()), (100, 100, 5));
    let all: HashSet<_> = first
        .iter()
        .chain(&second)
        .chain(&third)
        .map(|m| m.id.clone())
        .collect();
    assert_eq!(all.len(), 205);
    assert!(first.windows(2).all(|w| w[0].id < w[1].id), "pages are oldest first");
}

#[tokio::test]
async fn before_without_id_is_strictly_older_and_other_chats_are_excluded() {
    let f = Fixture::new().await;
    let session = f.session("History");
    for ts in [10, 20, 30] {
        f.store
            .store_message(&session.id, &text(format!("t{ts}"), JID, ts), None)
            .expect("message");
    }
    fill(&f, &session.id, "5522999999999@s.whatsapp.net", 3, 15);
    let read = |before: Option<f64>, limit: i64| -> Vec<String> {
        let page = HistoryPage {
            before,
            before_id: None,
            limit,
        };
        f.store
            .mirror_messages(&session.id, JID, &page)
            .expect("page")
            .into_iter()
            .map(|m| m.id)
            .collect()
    };
    assert_eq!(read(Some(30.0), 100), vec!["t10", "t20"]);
    assert_eq!(read(None, 1), vec!["t30"]);
}

#[tokio::test]
async fn admin_messages_endpoint_paginates_with_before_and_before_id() {
    let f = Fixture::new().await;
    let session = f.session("History");
    fill(&f, &session.id, JID, 205, 100);
    let base = format!("/api/sessions/{}/messages?jid={}&limit=100", session.id, JID);
    let pages = walk(|cursor| {
        let path = match cursor {
            None => base.clone(),
            Some((ts, id)) => format!("{base}&before={ts}&beforeId={id}"),
        };
        let f = &f;
        async move {
            f.admin("GET", &path, None)
                .await
                .body
                .as_array()
                .cloned()
                .unwrap_or_default()
        }
    })
    .await;
    assert_eq!(pages.iter().map(Vec::len).collect::<Vec<_>>(), vec![100, 100, 5]);
    assert_eq!(ids(&pages).len(), 205);
    let default = f
        .admin("GET", &format!("/api/sessions/{}/messages?jid={JID}", session.id), None)
        .await;
    assert_eq!(default.body.as_array().map(Vec::len), Some(100));
    let long_id = format!("beforeId={}", "x".repeat(201));
    for bad in ["limit=0", "limit=201", "before=0", "before=abc", long_id.as_str()] {
        let path = format!("/api/sessions/{}/messages?jid={JID}&{bad}", session.id);
        assert_eq!(f.admin("GET", &path, None).await.status, 400, "{bad}");
    }
    assert_eq!(
        f.admin("GET", &format!("/api/sessions/{}/messages", session.id), None)
            .await
            .status,
        400
    );
    let bad_jid = f
        .admin("GET", &format!("/api/sessions/{}/messages?jid=../x", session.id), None)
        .await;
    assert_eq!(bad_jid.status, 400);
}

#[tokio::test]
async fn helpdesk_history_paginates_the_conversation_mirror() {
    let f = Fixture::new().await;
    let session = f.session("Suporte");
    let admin = f.bootstrap().await;
    let contact = Incoming::default().jid;
    f.incoming(
        &session.id,
        Incoming {
            id: "IN1",
            ts: Some(50),
            ..Default::default()
        },
    );
    fill(&f, &session.id, contact, 120, 100);
    fill(&f, &session.id, JID, 10, 100);
    let pages = walk(|cursor| {
        let path = match cursor {
            None => "/conversations/1/history?limit=50".to_string(),
            Some((ts, id)) => {
                format!("/conversations/1/history?limit=50&before={ts}&before_id={id}")
            }
        };
        let admin = admin.clone();
        async move { admin.get(&path).await.body.as_array().cloned().unwrap_or_default() }
    })
    .await;
    assert_eq!(pages.iter().map(Vec::len).collect::<Vec<_>>(), vec![50, 50, 21]);
    let all = ids(&pages);
    assert_eq!(all.len(), 121);
    assert!(all.contains("IN1"));
    assert_eq!(pages[2][0]["id"], "IN1");
    let default = admin.get("/conversations/1/history").await.body;
    assert_eq!(default.as_array().map(Vec::len), Some(50));
    assert_eq!(admin.get("/conversations/1/history?limit=101").await.status, 400);
    assert_eq!(admin.get("/conversations/1/history?before=-1").await.status, 400);
    assert_eq!(admin.get("/conversations/99/history").await.status, 404);
}
