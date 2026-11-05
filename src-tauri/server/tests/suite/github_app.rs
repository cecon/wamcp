//! The app's own GitHub App: the administrator creates it from a manifest and installs it; each
//! repository of the installation becomes a GitHub inbox, its single webhook brings their events and
//! the agent acts with installation tokens renewed by the app.
use crate::common;
use crate::github_support;

use axum::body::Body;
use axum::http::Request;
use common::Fixture;
use github_support::{pr_opened, signature, REPO};
use serde_json::{json, Value};

const SECRET: &str = "whsec-do-app";

async fn deliver(f: &Fixture, event: &str, delivery: &str, payload: &Value, secret: &str) -> u16 {
    let body = serde_json::to_vec(payload).unwrap();
    let request = Request::post("/api/github/app/webhook")
        .header("content-type", "application/json")
        .header("x-github-event", event)
        .header("x-github-delivery", delivery)
        .header("x-hub-signature-256", signature(secret, &body))
        .body(Body::from(body))
        .unwrap();
    let status = f.public(request).await.status;
    f.settle().await;
    status
}

async fn get(f: &Fixture, path: &str) -> common::http::Reply {
    f.public(Request::get(path).body(Body::empty()).unwrap()).await
}

fn state_of(url: &str) -> String {
    url.split("state=").nth(1).unwrap().to_string()
}

#[tokio::test]
async fn the_administrator_creates_the_app_from_a_manifest_and_installs_it() {
    let f = Fixture::new().await;
    let admin = f.bootstrap().await;
    let maria = f.agent(&admin, "maria@example.com", "agent", false).await;
    assert_eq!(maria.post("/github_app", json!({})).await.status, 403);
    assert_eq!(admin.get("/github_app").await.body["app"], Value::Null);

    let started = admin.post("/github_app", json!({})).await;
    assert_eq!(started.status, 200, "{:?}", started.body);
    let url = started.body["url"].as_str().unwrap().to_string();
    let state = state_of(&url);

    // The page posts the manifest to GitHub; only github.com may receive the form.
    let page = get(&f, &format!("/api/github/app/new?state={state}")).await;
    assert_eq!(page.status, 200);
    assert!(page
        .text
        .contains(&format!("https://github.com/settings/apps/new?state={state}")));
    assert!(page.text.contains("/api/github/app/webhook"), "{}", page.text);
    assert!(page.text.contains("pull_request"));
    assert!(page
        .header("content-security-policy")
        .unwrap()
        .contains("form-action https://github.com"));
    assert_eq!(get(&f, "/api/github/app/new?state=outro").await.status, 400);

    f.github.answers.lock().insert(
        "MANIFEST c0de".into(),
        json!({ "id": 77, "slug": "wamcp-agente", "pem": "-----BEGIN RSA PRIVATE KEY-----", "webhook_secret": SECRET,
                "html_url": "https://github.com/apps/wamcp-agente", "owner": { "login": "cecon" } }),
    );
    // A conversion GitHub refuses leaves the state alive: reloading the callback finishes it.
    let refused = get(&f, &format!("/api/github/app/callback?state={state}&code=velho")).await;
    assert_eq!(refused.status, 400, "{}", refused.text);
    let back = get(&f, &format!("/api/github/app/callback?state={state}&code=c0de")).await;
    assert_eq!(back.status, 303, "{}", back.text);
    assert_eq!(
        back.header("location").as_deref(),
        Some("https://github.com/apps/wamcp-agente/installations/new")
    );
    assert_eq!(
        get(&f, &format!("/api/github/app/callback?state={state}&code=c0de"))
            .await
            .status,
        400,
        "a state is used once"
    );
    // The key and the secret are stored sealed.
    let stored: String = f
        .store
        .with(|db| db.query_row("SELECT private_key||webhook_secret FROM github_app", [], |r| r.get(0)))
        .unwrap();
    assert!(!stored.contains("PRIVATE KEY") && !stored.contains(SECRET));

    // Installing it on a repository makes the repository an inbox.
    let installed = json!({ "action": "created", "installation": { "id": 9 },
                            "repositories": [{ "full_name": REPO }] });
    assert_eq!(deliver(&f, "installation", "i1", &installed, "errado").await, 401);
    assert_eq!(deliver(&f, "installation", "i1", &installed, SECRET).await, 202);
    let status = admin.get("/github_app").await.body;
    assert_eq!(status["app"]["slug"], "wamcp-agente");
    assert_eq!(status["repos"][0]["repo"], REPO);
    let inbox = status["repos"][0]["inbox_id"].as_i64().unwrap();
    let setup = admin.get(&format!("/inboxes/{inbox}/github")).await.body;
    assert_eq!(
        (setup["via_app"].as_bool(), setup["hook_created"].as_bool()),
        (Some(true), Some(true))
    );
    assert_eq!(setup["account"], "wamcp-agente[bot]");

    // Its events come through the App's webhook into that inbox.
    let mut pr = pr_opened(12);
    pr["installation"] = json!({ "id": 9 });
    assert_eq!(deliver(&f, "pull_request", "d1", &pr, SECRET).await, 202);
    let list = admin
        .get(&format!("/conversations?inbox_id={inbox}&status=all"))
        .await
        .body;
    assert_eq!(list.as_array().unwrap().len(), 1, "{list:?}");
    assert_eq!(list[0]["contact_name"], "PR #12: Corrige login");

    // The agent acts with an installation token, asked once and reused while it lasts.
    let helpdesk = f.app.state.support().helpdesk.clone();
    let channel = helpdesk.core.repo.github_channel(inbox).unwrap().unwrap();
    let token = helpdesk.github_token(&channel).await.unwrap();
    assert_eq!(token, "ghs_/app/installations/9/access_tokens");
    helpdesk.github_token(&channel).await.unwrap();
    let asked = f
        .github
        .calls
        .lock()
        .iter()
        .filter(|(m, p, _)| m == "APP POST" && p.ends_with("/access_tokens"))
        .count();
    assert_eq!(asked, 1);

    // Removing the repository from the installation unlinks the inbox and keeps its conversations.
    let removed = json!({ "action": "removed", "installation": { "id": 9 },
                          "repositories_added": [], "repositories_removed": [{ "full_name": REPO }] });
    deliver(&f, "installation_repositories", "i2", &removed, SECRET).await;
    assert_eq!(admin.get("/github_app").await.body["repos"], json!([]));
}

#[tokio::test]
async fn a_repository_connected_with_a_token_moves_to_the_app_when_it_is_installed() {
    let c = github_support::connected().await;
    let helpdesk = c.f.app.state.support().helpdesk.clone();
    helpdesk
        .core
        .repo
        .save_github_app(&wamcp_server::domain::model::GithubApp {
            app_id: 77,
            slug: "wamcp-agente".into(),
            html_url: "https://github.com/apps/wamcp-agente".into(),
            owner: None,
            private_key: helpdesk.secrets.seal("pem").unwrap(),
            webhook_secret: helpdesk.secrets.seal(SECRET).unwrap(),
        })
        .unwrap();
    // GitHub's case of the name is not always the one typed when connecting.
    let installed = json!({ "action": "created", "installation": { "id": 5 },
                            "repositories": [{ "full_name": "Cecon/WAMCP" }] });
    deliver(&c.f, "installation", "i1", &installed, SECRET).await;
    let channel = helpdesk.core.repo.github_channel(c.inbox).unwrap().unwrap();
    assert_eq!(channel.installation_id, Some(5));
    let setup = c.admin.get(&format!("/inboxes/{}/github", c.inbox)).await.body;
    assert_eq!(setup["account"], "wamcp-agente[bot]", "it acts as the App now");
    assert_eq!(
        helpdesk.core.repo.github_channels().unwrap().len(),
        1,
        "no second inbox"
    );
    assert_eq!(
        helpdesk.github_token(&channel).await.unwrap(),
        "ghs_/app/installations/5/access_tokens"
    );
}
