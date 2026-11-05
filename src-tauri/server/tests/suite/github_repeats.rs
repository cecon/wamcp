//! A workflow that keeps failing on main reaches the conversation every time, but only the first
//! failure is an incoming message (the one that wakes the agent); a passing run resets it.
use crate::github_support;

use github_support::{connected, repository};
use serde_json::{json, Value};

fn run(workflow: &str, conclusion: &str, sha: &str) -> Value {
    json!({ "action": "completed", "sender": { "login": "maria" }, "repository": repository(),
            "workflow_run": { "name": workflow, "conclusion": conclusion, "head_branch": "main", "head_sha": sha,
                              "html_url": "https://github.com/cecon/wamcp/actions/runs/9", "pull_requests": [] } })
}

#[tokio::test]
async fn a_failure_that_repeats_on_main_wakes_the_agent_once() {
    let c = connected().await;
    for (delivery, workflow, conclusion, sha) in [
        ("r1", "pages", "failure", "aaaaaaa1"),
        ("r2", "pages", "failure", "bbbbbbb2"),
        ("r3", "engine", "failure", "bbbbbbb2"),
        ("r4", "pages", "success", "ccccccc3"),
        ("r5", "pages", "failure", "ddddddd4"),
    ] {
        assert_eq!(
            c.deliver("workflow_run", delivery, &run(workflow, conclusion, sha), None)
                .await,
            202
        );
    }
    let list = c.conversations().await;
    assert_eq!(list.len(), 1, "{list:?}");
    let messages = c
        .admin
        .get(&format!("/conversations/{}/messages", list[0]["display_id"]))
        .await
        .body;
    let kinds: Vec<(String, String)> = messages
        .as_array()
        .unwrap()
        .iter()
        .filter(|m| m["content"].as_str().is_some_and(|t| t.contains("falhou")))
        .map(|m| {
            let text = m["content"].as_str().unwrap();
            let sha = text.split('(').nth(2).unwrap_or_default().chars().take(7).collect();
            (m["message_type"].as_str().unwrap_or_default().to_string(), sha)
        })
        .collect();
    assert_eq!(
        kinds,
        [
            ("incoming", "aaaaaaa"),
            ("activity", "bbbbbbb"),
            ("incoming", "bbbbbbb"),
            ("incoming", "ddddddd")
        ]
        .map(|(k, s)| (k.to_string(), s.to_string())),
        "{messages:?}"
    );
}
