//! The AI agent of a GitHub inbox acts on the repository during its run (a scripted fake runtime
//! here): it reads the pull request and its checks, approves, merges, labels and forwards the
//! conversation to its supervisor. The echoes of its own actions do not wake it again, and the
//! tools only serve a run in progress, on this computer.
use crate::agents_support;
use crate::common;
use crate::github_support;

use agents_support::{ai, profiles};
use async_trait::async_trait;
use common::http::request;
use github_support::{connected, pr_opened, repository, Channel, REPO};
use parking_lot::Mutex;
use serde_json::{json, Value};
use std::sync::Arc;
use std::time::Duration;
use wamcp_server::adapters::outbound::llm::LlmRouter;
use wamcp_server::application::github_agent::GithubRun;
use wamcp_server::application::helpdesk::HelpdeskService;
use wamcp_server::application::ports::{Completion, Llm, LlmRequest};
use wamcp_server::domain::error::Result;

/// Calls the scripted tools on its next run with tools, then answers `reply`.
struct Maintainer {
    helpdesk: HelpdeskService,
    script: Mutex<Vec<(&'static str, Value)>>,
    reply: &'static str,
    requests: Mutex<Vec<LlmRequest>>,
    results: Mutex<Vec<String>>,
}

#[async_trait]
impl Llm for Maintainer {
    async fn complete(&self, request: &LlmRequest) -> Result<Completion> {
        self.requests.lock().push(request.clone());
        if let Some(mcp) = &request.mcp {
            let script: Vec<_> = self.script.lock().drain(..).collect();
            for (name, args) in script {
                let outcome = self.helpdesk.github_tool(&mcp.token, name, &args).await;
                let text = outcome.map_or_else(|e| format!("erro: {e}"), |v| v.to_string());
                self.results.lock().push(text);
            }
        }
        Ok(json!({ "reply": self.reply, "handoff": false }).into())
    }

    fn location(&self) -> Option<String> {
        Some("C:/bin/claude.exe".into())
    }
}

/// A connected channel answered by Jhon (Claude Code), whose supervisor is the administrator.
async fn served(script: Vec<(&'static str, Value)>, reply: &'static str) -> (Channel, Arc<Maintainer>) {
    let mut c = connected().await;
    let runtime = Arc::new(Maintainer {
        helpdesk: c.f.app.state.support().helpdesk.clone(),
        script: Mutex::new(script),
        reply,
        requests: Mutex::default(),
        results: Mutex::default(),
    });
    c.f.app.attach_llm(
        Arc::new(LlmRouter::default().with("claude_cli", runtime.clone())),
        Duration::ZERO,
    );
    let _ = c.f.app.mcp_url.set("http://127.0.0.1:1/mcp-system".into());
    let roster = c.admin.get("/agent_directory").await.body;
    let me = roster
        .as_array()
        .unwrap()
        .iter()
        .find(|a| a["user_id"].is_i64())
        .unwrap()
        .clone();
    let mut body = ai(&profiles(&c.admin).await, "Jhon", "operator");
    body["supervisor_id"] = me["id"].clone();
    let jhon = c.admin.post("/agent_directory", body).await.body["id"].clone();
    let path = format!("/inboxes/{}/ai_agent", c.inbox);
    let linked = c.admin.post(&path, json!({ "ai_agent_id": jhon })).await;
    assert_eq!(linked.status, 200, "{:?}", linked.body);
    (c, runtime)
}

fn answer(c: &Channel, key: &str, value: Value) {
    c.f.github.answers.lock().insert(key.into(), value);
}

#[tokio::test]
async fn the_agent_checks_approves_merges_and_ignores_the_echoes() {
    let script = vec![
        ("item", json!({})),
        ("review", json!({ "event": "APPROVE", "body": "Diff e checks ok." })),
        ("merge", json!({ "method": "squash" })),
        ("labels", json!({ "add": ["aprovado"], "remove": ["em revisão"] })),
        ("run_jobs", json!({ "run_id": 41 })),
    ];
    let (c, runtime) = served(script, "Aprovado e mesclado.").await;
    let repo = format!("/repos/{REPO}");
    answer(
        &c,
        &format!("GET {repo}/issues/7"),
        json!({ "title": "Corrige login", "state": "open",
        "user": { "login": "maria" }, "labels": [], "assignees": [], "pull_request": {} }),
    );
    answer(
        &c,
        &format!("GET {repo}/pulls/7"),
        json!({ "head": { "ref": "fix/login", "sha": "abc" },
        "base": { "ref": "main" }, "mergeable": true, "requested_reviewers": [] }),
    );
    answer(
        &c,
        &format!("GET {repo}/commits/abc/check-runs?per_page=100"),
        json!({ "check_runs": [{
        "name": "quality", "status": "completed", "conclusion": "success",
        "html_url": format!("https://github.com/{REPO}/actions/runs/41/job/124") }] }),
    );
    answer(
        &c,
        &format!("GET {repo}/actions/runs/41/jobs?per_page=100"),
        json!({ "jobs": [{ "id": 124, "name": "engine", "status": "completed", "conclusion": "failure",
        "steps": [{ "name": "Checkout", "conclusion": "success" }, { "name": "cargo test", "conclusion": "failure" }] }] }),
    );
    answer(
        &c,
        &format!("PUT {repo}/pulls/7/merge"),
        json!({ "merged": true, "sha": "def" }),
    );

    c.deliver("pull_request", "d1", &pr_opened(7), None).await;
    let request = runtime.requests.lock()[0].clone();
    let mcp = request.mcp.clone().expect("tools open for the run");
    assert_eq!(
        (mcp.name.as_str(), mcp.url.as_str()),
        ("github", "http://127.0.0.1:1/mcp-github")
    );
    assert!(
        request.system.contains("antes de aprovar ou mesclar"),
        "{}",
        request.system
    );
    let results = runtime.results.lock().clone();
    assert!(
        results[0].contains("\"run_id\":41") && results[0].contains("\"job_id\":124"),
        "{results:?}"
    );
    assert!(results.iter().all(|r| !r.starts_with("erro")), "{results:?}");
    assert!(results[4].contains(r#""failed_steps":["cargo test"]"#), "{results:?}");

    let calls = c.f.github.calls.lock().clone();
    let find = |method: &str, path: &str| {
        calls
            .iter()
            .find(|(m, p, _)| m == method && p == path)
            .map(|c| c.2.clone())
    };
    let review = find("POST", &format!("{repo}/pulls/7/reviews")).unwrap();
    assert_eq!(review["event"], "APPROVE");
    assert!(review["body"].as_str().unwrap().ends_with("<!-- wamcp -->"));
    assert_eq!(
        find("PUT", &format!("{repo}/pulls/7/merge")).unwrap()["merge_method"],
        "squash"
    );
    assert_eq!(
        find("POST", &format!("{repo}/issues/7/labels")).unwrap()["labels"],
        json!(["aprovado"])
    );
    assert!(
        find("DELETE", &format!("{repo}/issues/7/labels/em%20revis%C3%A3o")).is_some(),
        "{calls:?}"
    );
    assert_eq!(
        c.f.github.comments.lock()[0].2,
        "Aprovado e mesclado.\n\n<!-- wamcp -->"
    );

    // GitHub tells the channel about the merge and the approval: kept as activity, no new run.
    let pr = json!({ "number": 7, "title": "Corrige login", "merged": true,
                     "html_url": format!("https://github.com/{REPO}/pull/7") });
    let merged = json!({ "action": "closed", "sender": { "login": "wamcp-bot" }, "repository": repository(), "pull_request": pr });
    c.deliver("pull_request", "d2", &merged, None).await;
    let approved = json!({ "action": "submitted", "sender": { "login": "wamcp-bot" }, "repository": repository(),
                           "pull_request": pr, "review": { "state": "approved", "body": "" } });
    c.deliver("pull_request_review", "d3", &approved, None).await;
    assert_eq!(runtime.requests.lock().len(), 1);
    let list = c.conversations().await;
    let messages = c.messages(&list[0]["display_id"]).await;
    assert!(
        messages.iter().any(|m| m == "@wamcp-bot mesclou o PR #7."),
        "{messages:?}"
    );

    // Someone else's event still reaches the agent.
    let asked = json!({ "action": "review_requested", "sender": { "login": "maria" }, "repository": repository(),
                        "pull_request": pr, "requested_reviewer": { "login": "joao" } });
    c.deliver("pull_request", "d4", &asked, None).await;
    assert_eq!(runtime.requests.lock().len(), 2);
    let messages = c.messages(&list[0]["display_id"]).await;
    assert!(
        messages
            .iter()
            .any(|m| m == "@maria pediu a revisão de @joao no PR #7."),
        "{messages:?}"
    );
}

#[tokio::test]
async fn the_agent_forwards_the_conversation_to_its_supervisor() {
    let script = vec![("forward", json!({ "note": "Precisa de uma decisão de produto." }))];
    let (c, runtime) = served(script, "Encaminhei para o responsável.").await;
    let issue = json!({ "action": "opened", "sender": { "login": "maria" }, "repository": repository(),
        "issue": { "number": 9, "title": "Novo relatório", "body": "Queremos um relatório mensal.",
                   "html_url": format!("https://github.com/{REPO}/issues/9") } });
    c.deliver("issues", "d1", &issue, None).await;
    assert!(
        runtime.results.lock()[0].contains("forwarded_to"),
        "{:?}",
        runtime.results.lock()
    );

    let conversation = c.conversations().await[0].clone();
    assert_eq!(conversation["status"], "open", "the human team takes over");
    let roster = c.admin.get("/agent_directory").await.body;
    let admin = roster
        .as_array()
        .unwrap()
        .iter()
        .find(|a| a["user_id"].is_i64())
        .unwrap();
    assert_eq!(conversation["assignee_id"], admin["user_id"]);
    let messages = c.messages(&conversation["display_id"]).await;
    assert!(
        messages
            .iter()
            .any(|m| m.ends_with(": Precisa de uma decisão de produto.")),
        "{messages:?}"
    );
    assert_eq!(
        c.f.github.comments.lock()[0].2,
        "Encaminhei para o responsável.\n\n<!-- wamcp -->"
    );
}

#[tokio::test]
async fn the_tools_only_serve_a_run_in_progress_on_this_computer() {
    let c = connected().await;
    let helpdesk = c.f.app.state.support().helpdesk.clone();
    let call = json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/list" });
    let denied =
        c.f.public(request(
            "POST",
            "/mcp-github",
            Some(call.clone()),
            &[("authorization", "Bearer wgh_x")],
        ))
        .await;
    assert_eq!(denied.status, 401);

    let token = helpdesk.open_github_run(GithubRun {
        inbox_id: c.inbox,
        display_id: 1,
        source_id: format!("{REPO}@atividade"),
        agent_id: None,
        handoff: false,
    });
    let auth = format!("Bearer {token}");
    let listed =
        c.f.public(request("POST", "/mcp-github", Some(call), &[("authorization", &auth)]))
            .await;
    assert_eq!(listed.status, 200, "{:?}", listed.body);
    assert_eq!(listed.body["result"]["tools"].as_array().unwrap().len(), 13);
    let tunnel = [("authorization", auth.as_str()), ("cf-connecting-ip", "1.2.3.4")];
    let ping = json!({ "jsonrpc": "2.0", "id": 2, "method": "ping" });
    assert_eq!(
        c.f.public(request("POST", "/mcp-github", Some(ping), &tunnel))
            .await
            .status,
        404
    );

    // The activity conversation has no pull request of its own, and this run has no supervisor.
    let item = helpdesk.github_tool(&token, "item", &json!({})).await.unwrap_err();
    assert!(item.to_string().contains("Informe number"), "{item}");
    let forward = helpdesk
        .github_tool(&token, "forward", &json!({ "note": "x" }))
        .await
        .unwrap_err();
    assert!(forward.to_string().contains("responsável direto"), "{forward}");
    let bad = helpdesk
        .github_tool(&token, "assign", &json!({ "number": 3, "assignees": ["a/b"] }))
        .await;
    assert!(bad.is_err());
    assert!(helpdesk.close_github_run(&token).is_some());
    assert!(helpdesk
        .github_tool(&token, "item", &json!({ "number": 3 }))
        .await
        .is_err());
}
