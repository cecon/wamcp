//! The GitHub REST API (api.github.com) for GitHub inboxes, plus an in-memory double for tests.
use crate::application::ports::GithubApi;
use crate::domain::error::{fail, fail_with, Result};
use async_trait::async_trait;
use parking_lot::Mutex;
use serde_json::{json, Value};
use std::time::Duration;

const API: &str = "https://api.github.com";

pub struct HttpGithub {
    client: reqwest::Client,
}

impl HttpGithub {
    pub fn new() -> Self {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(15))
            .redirect(reqwest::redirect::Policy::none())
            .user_agent("wamcp-github")
            .build()
            .unwrap_or_default();
        Self { client }
    }

    async fn call(&self, token: &str, method: reqwest::Method, path: &str, body: Option<Value>) -> Result<Value> {
        let mut request = self
            .client
            .request(method, format!("{API}{path}"))
            .bearer_auth(token)
            .header("Accept", "application/vnd.github+json")
            .header("X-GitHub-Api-Version", "2022-11-28");
        if let Some(body) = body {
            request = request.json(&body);
        }
        let response = match request.send().await {
            Ok(response) => response,
            Err(_) => return fail("Não foi possível falar com o GitHub"),
        };
        let status = response.status().as_u16();
        let data: Value = response.json().await.unwrap_or(Value::Null);
        if (200..300).contains(&status) {
            return Ok(data);
        }
        let detail = data["message"].as_str().unwrap_or("erro desconhecido");
        let message = match status {
            401 => "O GitHub recusou o token (inválido ou expirado)".to_string(),
            403 | 404 => format!("O token não tem acesso a isso no GitHub ({detail})"),
            _ => format!("O GitHub respondeu {status}: {detail}"),
        };
        fail_with(message, 422)
    }
}

impl Default for HttpGithub {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl GithubApi for HttpGithub {
    async fn login(&self, token: &str) -> Result<String> {
        let user = self.call(token, reqwest::Method::GET, "/user", None).await?;
        Ok(user["login"].as_str().unwrap_or_default().to_string())
    }

    async fn repository(&self, token: &str, repo: &str) -> Result<()> {
        self.call(token, reqwest::Method::GET, &format!("/repos/{repo}"), None)
            .await
            .map(|_| ())
    }

    async fn create_hook(&self, token: &str, repo: &str, url: &str, secret: &str, events: &[&str]) -> Result<i64> {
        let body = json!({
            "name": "web",
            "active": true,
            "events": events,
            "config": { "url": url, "content_type": "json", "secret": secret, "insecure_ssl": "0" },
        });
        let hook = self
            .call(
                token,
                reqwest::Method::POST,
                &format!("/repos/{repo}/hooks"),
                Some(body),
            )
            .await?;
        Ok(hook["id"].as_i64().unwrap_or_default())
    }

    async fn comment(&self, token: &str, repo: &str, number: u64, body: &str) -> Result<String> {
        let path = format!("/repos/{repo}/issues/{number}/comments");
        let comment = self
            .call(token, reqwest::Method::POST, &path, Some(json!({ "body": body })))
            .await?;
        Ok(comment["html_url"].as_str().unwrap_or_default().to_string())
    }
}

/// Records what would reach GitHub. `refuse_hooks` simulates a token without webhook permission.
#[derive(Default)]
pub struct MemoryGithub {
    pub comments: Mutex<Vec<(String, u64, String)>>,
    pub hooks: Mutex<Vec<(String, String, String)>>,
    pub refuse_hooks: bool,
}

#[async_trait]
impl GithubApi for MemoryGithub {
    async fn login(&self, token: &str) -> Result<String> {
        if token.is_empty() {
            return fail_with("O GitHub recusou o token (inválido ou expirado)", 422);
        }
        Ok("wamcp-bot".into())
    }

    async fn repository(&self, _token: &str, _repo: &str) -> Result<()> {
        Ok(())
    }

    async fn create_hook(&self, _token: &str, repo: &str, url: &str, secret: &str, _events: &[&str]) -> Result<i64> {
        if self.refuse_hooks {
            return fail_with("O token não tem acesso a isso no GitHub (Resource not accessible)", 422);
        }
        let mut hooks = self.hooks.lock();
        hooks.push((repo.into(), url.into(), secret.into()));
        Ok(i64::try_from(hooks.len()).unwrap_or_default())
    }

    async fn comment(&self, _token: &str, repo: &str, number: u64, body: &str) -> Result<String> {
        self.comments.lock().push((repo.into(), number, body.into()));
        Ok(format!("https://github.com/{repo}/issues/{number}#issuecomment-1"))
    }
}
