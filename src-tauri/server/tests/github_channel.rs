//! A GitHub repository as a channel: the administrator connects it (token checked, webhook created),
//! signed webhook deliveries become one conversation per pull request or issue (pushes and failed
//! workflows go to the repository's activity), and the inbox's AI agent answers with a comment.
mod agents_support;
mod common;

use agents_support::{ai, profiles};
use async_trait::async_trait;
use axum::body::Body;
use axum::http::Request;
use common::Fixture;
use hmac::{Hmac, Mac};
use parking_lot::Mutex;
use serde_json::{json, Value};
use sha2::Sha256;
use std::sync::Arc;
use std::time::Duration;
use wamcp_server::adapters::outbound::llm::LlmRouter;
use wamcp_server::application::ports::{Completion, Llm, LlmRequest, TokenUsage};
use wamcp_server::domain::error::Result;

const REPO: &str = "cecon/wamcp";

/// Comments on pull requests and stays quiet on pushes.
#[derive(Default)]
struct Reviewer {
    requests: Mutex<Vec<LlmRequest>>,
}

#[async_trait]
impl Llm for Reviewer {
    async fn complete(&self, request: &LlmRequest) -> Result<Completion> {
        self.requests.lock().push(request.clone());
        let reply = if request.prompt.contains("commit(s) para main") {
            ""
        } else {
            "Revisei: falta teste."
        };
        Ok(Completion {
            answer: json!({ "reply": reply, "handoff": false }),
            usage: TokenUsage::default(),
        })
    }

    fn location(&self) -> Option<String> {
        Some("C:/bin/claude.exe".into())
    }
}

struct Channel {
    f: Fixture,
    admin: common::Agent,
    inbox: i64,
    secret: String,
}

async fn connected() -> Channel {
    let f = Fixture::new().await;
    let admin = f.bootstrap().await;
    let reply = admin
        .post(
            "/github_channels",
            json!({ "name": "wamcp no GitHub", "repo": REPO, "token": "ghp_teste" }),
        )
        .await;
    assert_eq!(reply.status, 201, "{:?}", reply.body);
    let inbox = reply.body["inbox"]["id"].as_i64().unwrap();
    let secret = reply.body["webhook_secret"].as_str().unwrap().to_string();
    Channel {
        f,
        admin,
        inbox,
        secret,
    }
}

fn signature(secret: &str, body: &[u8]) -> String {
    let mut mac = Hmac::<Sha256>::new_from_slice(secret.as_bytes()).unwrap();
    mac.update(body);
    format!("sha256={}", hex::encode(mac.finalize().into_bytes()))
}

fn repository() -> Value {
    json!({ "full_name": REPO, "default_branch": "main", "html_url": format!("https://github.com/{REPO}") })
}

fn pr_opened(number: u64) -> Value {
    json!({ "action": "opened", "sender": { "login": "maria" }, "repository": repository(),
            "pull_request": { "number": number, "title": "Corrige login", "body": "Troca o token de lugar.",
                              "html_url": format!("https://github.com/{REPO}/pull/{number}"),
                              "head": { "ref": "fix/login" }, "base": { "ref": "main" } } })
}

impl Channel {
    async fn deliver(&self, event: &str, delivery: &str, payload: &Value, secret: Option<&str>) -> u16 {
        let body = serde_json::to_vec(payload).unwrap();
        let signed = signature(secret.unwrap_or(&self.secret), &body);
        let request = Request::post(format!("/api/github/{}/webhook", self.inbox))
            .header("content-type", "application/json")
            .header("x-github-event", event)
            .header("x-github-delivery", delivery)
            .header("x-hub-signature-256", signed)
            .body(Body::from(body))
            .unwrap();
        let status = self.f.public(request).await.status;
        self.f.settle().await;
        status
    }

    async fn conversations(&self) -> Vec<Value> {
        let list = self
            .admin
            .get(&format!("/conversations?inbox_id={}&status=all", self.inbox))
            .await;
        list.body.as_array().cloned().unwrap_or_default()
    }

    async fn messages(&self, display_id: &Value) -> Vec<String> {
        let list = self
            .admin
            .get(&format!("/conversations/{display_id}/messages"))
            .await
            .body;
        list.as_array()
            .unwrap()
            .iter()
            .filter_map(|m| m["content"].as_str().map(String::from))
            .collect()
    }
}

#[tokio::test]
async fn the_administrator_connects_a_repository_and_its_webhook_is_created() {
    let c = connected().await;
    let hooks = c.f.github.hooks.lock().clone();
    assert_eq!(hooks.len(), 1);
    assert_eq!(hooks[0].0, REPO);
    assert!(
        hooks[0].1.ends_with(&format!("/api/github/{}/webhook", c.inbox)),
        "{}",
        hooks[0].1
    );
    assert_eq!(hooks[0].2, c.secret);

    let inbox = c.admin.get(&format!("/inboxes/{}", c.inbox)).await.body;
    assert_eq!(
        (inbox["channel_type"].as_str(), inbox["github_repo"].as_str()),
        (Some("github"), Some(REPO))
    );
    let setup = c.admin.get(&format!("/inboxes/{}/github", c.inbox)).await.body;
    assert_eq!(setup["hook_created"], true);
    assert_eq!(setup["account"], "wamcp-bot");

    // The token and the secret are stored encrypted.
    let stored: String =
        c.f.store
            .with(|db| db.query_row("SELECT token||webhook_secret FROM channel_github", [], |r| r.get(0)))
            .unwrap();
    assert!(!stored.contains("ghp_teste") && !stored.contains(&c.secret));

    let maria = c.f.agent(&c.admin, "maria@example.com", "agent", false).await;
    let refused = maria
        .post("/github_channels", json!({ "name": "x", "repo": "a/b", "token": "t" }))
        .await;
    assert_eq!(refused.status, 403);
    let invalid = c
        .admin
        .post(
            "/github_channels",
            json!({ "name": "x", "repo": "sem-barra", "token": "t" }),
        )
        .await;
    assert_eq!(invalid.status, 422);
}

#[tokio::test]
async fn signed_events_become_one_conversation_per_pull_request() {
    let c = connected().await;
    assert_eq!(
        c.deliver("pull_request", "d1", &pr_opened(12), Some("errado")).await,
        401
    );
    assert!(c.conversations().await.is_empty());

    assert_eq!(c.deliver("pull_request", "d1", &pr_opened(12), None).await, 202);
    assert_eq!(
        c.deliver("pull_request", "d1", &pr_opened(12), None).await,
        202,
        "redelivery"
    );
    let comment = json!({ "action": "created", "sender": { "login": "joao" }, "repository": repository(),
        "issue": { "number": 12, "title": "Corrige login", "pull_request": {} }, "comment": { "body": "Ficou bom?" } });
    c.deliver("issue_comment", "d2", &comment, None).await;
    // The app's own comment comes back as an event: it carries the mark, whoever the author is.
    let echo = json!({ "action": "created", "sender": { "login": "wamcp-bot" }, "repository": repository(),
        "issue": { "number": 12, "title": "Corrige login", "pull_request": {} },
        "comment": { "body": "eco\n\n<!-- wamcp -->" } });
    c.deliver("issue_comment", "d3", &echo, None).await;

    let list = c.conversations().await;
    assert_eq!(list.len(), 1);
    assert_eq!(list[0]["contact_name"], "PR #12: Corrige login");
    let messages = c.messages(&list[0]["display_id"]).await;
    assert_eq!(messages.len(), 2, "{messages:?}");
    assert!(messages[0].starts_with("@maria abriu o PR #12: Corrige login\nfix/login → main"));
    assert_eq!(messages[1], "@joao comentou:\n\nFicou bom?");

    let push = |branch: &str| {
        json!({ "ref": format!("refs/heads/{branch}"), "sender": { "login": "maria" }, "repository": repository(),
                "commits": [{ "id": "abcdef1234567", "message": "Ajusta CI\n\ncorpo" }] })
    };
    c.deliver("push", "d4", &push("feature"), None).await;
    assert_eq!(c.conversations().await.len(), 1, "pushes outside main are ignored");
    c.deliver("push", "d5", &push("main"), None).await;
    let list = c.conversations().await;
    let activity = list
        .iter()
        .find(|c| c["contact_name"] == format!("Atividade de {REPO}"))
        .unwrap();
    assert_eq!(
        c.messages(&activity["display_id"]).await,
        ["@maria enviou 1 commit(s) para main:\n- abcdef1 Ajusta CI"]
    );
}

#[tokio::test]
async fn the_inbox_agent_takes_a_position_with_a_comment_on_github() {
    let mut c = connected().await;
    let reviewer = Arc::new(Reviewer::default());
    c.f.app.attach_llm(
        Arc::new(LlmRouter::default().with("claude_cli", reviewer.clone())),
        Duration::ZERO,
    );
    let p = profiles(&c.admin).await;
    let jhon = c.admin.post("/agent_directory", ai(&p, "Jhon", "operator")).await.body["id"].clone();
    let linked = c
        .admin
        .post(
            &format!("/inboxes/{}/ai_agent", c.inbox),
            json!({ "ai_agent_id": jhon }),
        )
        .await;
    assert_eq!(linked.status, 200, "{:?}", linked.body);

    c.deliver("pull_request", "d1", &pr_opened(7), None).await;
    assert_eq!(
        c.f.github.comments.lock().clone(),
        [(
            REPO.to_string(),
            7,
            "Revisei: falta teste.\n\n<!-- wamcp -->".to_string()
        )]
    );
    let request = reviewer.requests.lock()[0].clone();
    assert!(request.system.contains("repositório no GitHub"), "{}", request.system);
    assert!(
        request.prompt.contains("GitHub: @maria abriu o PR #7"),
        "{}",
        request.prompt
    );

    // GitHub echoes the comment back, signed by the token's account: it does not wake the agent again.
    let posted = c.f.github.comments.lock()[0].2.clone();
    let echo = json!({ "action": "created", "sender": { "login": "wamcp-bot" }, "repository": repository(),
        "issue": { "number": 7, "title": "Corrige login", "pull_request": {} }, "comment": { "body": posted } });
    c.deliver("issue_comment", "d1-echo", &echo, None).await;
    assert_eq!(reviewer.requests.lock().len(), 1);

    // The token's account is often the person's own: what they do on GitHub still reaches the agent.
    let mine = json!({ "action": "created", "sender": { "login": "wamcp-bot" }, "repository": repository(),
        "issue": { "number": 7, "title": "Corrige login", "pull_request": {} }, "comment": { "body": "E agora?" } });
    c.deliver("issue_comment", "d1-mine", &mine, None).await;
    assert_eq!(reviewer.requests.lock().len(), 2);
    assert_eq!(c.f.github.comments.lock().len(), 2);

    // On the activity conversation the agent has no pull request to comment on.
    let push = json!({ "ref": "refs/heads/main", "sender": { "login": "maria" }, "repository": repository(),
                       "commits": [{ "id": "abcdef1234567", "message": "x" }] });
    c.deliver("push", "d2", &push, None).await;
    assert_eq!(c.f.github.comments.lock().len(), 2);
    assert!(c.f.wa.sent().is_empty(), "nothing goes to WhatsApp");
}
