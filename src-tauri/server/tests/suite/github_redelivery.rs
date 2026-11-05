//! Deliveries GitHub could not hand to the app (closed, tunnel down) are asked again, once each,
//! oldest first; ones that already arrived or kept failing are left alone.
use crate::github_support;

use github_support::{connected, pr_opened, REPO};
use serde_json::{json, Value};
use wamcp_server::application::github_redelivery::to_redeliver;

fn delivery(id: i64, guid: &str, status: u64) -> Value {
    json!({ "id": id, "guid": guid, "status_code": status, "event": "pull_request", "redelivery": false })
}

#[test]
fn only_deliveries_that_never_arrived_are_sent_again() {
    let list = [
        delivery(9, "late", 0),
        delivery(7, "ok", 202),
        delivery(5, "retried", 502),
        delivery(6, "retried", 202),
        delivery(4, "stored", 0),
        delivery(3, "stubborn", 0),
        delivery(10, "stubborn", 0),
        delivery(11, "stubborn", 0),
        delivery(12, "stubborn", 0),
        delivery(2, "first", 503),
    ];
    assert_eq!(to_redeliver(&list, |guid| guid == "stored"), [2, 9]);
}

#[tokio::test]
async fn the_app_asks_github_to_send_the_failed_deliveries_again() {
    let c = connected().await;
    let hook = format!("/repos/{REPO}/hooks/1/deliveries");
    c.f.github.answers.lock().insert(
        format!("GET {hook}?per_page=100"),
        json!([delivery(31, "d-perdida", 0), delivery(30, "d-chegou", 0)]),
    );
    // "d-chegou" reached the inbox meanwhile (a manual redelivery, for instance).
    c.deliver("pull_request", "d-chegou", &pr_opened(12), None).await;

    let helpdesk = c.f.app.state.support().helpdesk.clone();
    assert_eq!(helpdesk.redeliver_github().await.unwrap(), 1);
    let posts: Vec<String> =
        c.f.github
            .calls
            .lock()
            .iter()
            .filter(|(method, ..)| method == "POST")
            .map(|(_, path, _)| path.clone())
            .collect();
    assert_eq!(posts, [format!("{hook}/31/attempts")]);
}
