//! The GitHub REST API (api.github.com) for GitHub inboxes, plus an in-memory double for tests.
use super::github_jwt::app_jwt;
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
        let mut request = self.client.request(method, format!("{API}{path}")).bearer_auth(token);
        if let Some(body) = body {
            request = request.json(&body);
        }
        self.send(request).await
    }

    async fn send(&self, request: reqwest::RequestBuilder) -> Result<Value> {
        let request = request
            .header("Accept", "application/vnd.github+json")
            .header("X-GitHub-Api-Version", "2022-11-28");
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

    async fn api(&self, token: &str, method: &str, path: &str, body: Option<Value>) -> Result<Value> {
        let Ok(method) = reqwest::Method::from_bytes(method.as_bytes()) else {
            return fail("Método HTTP inválido");
        };
        self.call(token, method, path, body).await
    }

    async fn convert_manifest(&self, code: &str) -> Result<Value> {
        let url = format!("{API}/app-manifests/{code}/conversions");
        self.send(self.client.post(url)).await
    }

    async fn app_api(&self, app_id: i64, pem: &str, method: &str, path: &str, body: Option<Value>) -> Result<Value> {
        let jwt = app_jwt(app_id, pem, chrono::Utc::now().timestamp())?;
        self.api(&jwt, method, path, body).await
    }

    async fn job_log(&self, token: &str, repo: &str, job_id: u64) -> Result<String> {
        // GitHub answers with a redirect to a short-lived download address (no token goes there).
        let response = self
            .client
            .get(format!("{API}/repos/{repo}/actions/jobs/{job_id}/logs"))
            .bearer_auth(token)
            .header("X-GitHub-Api-Version", "2022-11-28")
            .send()
            .await;
        let Ok(response) = response else {
            return fail("Não foi possível falar com o GitHub");
        };
        let location = response
            .headers()
            .get(reqwest::header::LOCATION)
            .and_then(|l| l.to_str().ok())
            .map(String::from);
        let Some(location) = location.filter(|_| response.status().is_redirection()) else {
            let status = response.status().as_u16();
            return fail_with(format!("O GitHub não entregou o log do job ({status})"), 422);
        };
        let log = self.client.get(location).send().await;
        match log {
            Ok(log) if log.status().is_success() => Ok(log.text().await.unwrap_or_default()),
            _ => fail("Não foi possível baixar o log do job"),
        }
    }
}

/// Records what would reach GitHub. `refuse_hooks` simulates a token without webhook permission;
/// `answers` holds what `api` and `job_log` return, by `"GET /repos/…"` or `"LOG <job id>"`, the
/// App created from a manifest code (`"MANIFEST <code>"`) and what `app_api` returns (`"APP GET /…"`).
#[derive(Default)]
pub struct MemoryGithub {
    pub comments: Mutex<Vec<(String, u64, String)>>,
    pub hooks: Mutex<Vec<(String, String, String)>>,
    pub refuse_hooks: std::sync::atomic::AtomicBool,
    pub calls: Mutex<Vec<(String, String, Value)>>,
    pub answers: Mutex<std::collections::HashMap<String, Value>>,
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
        if self.refuse_hooks.load(std::sync::atomic::Ordering::Relaxed) {
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

    async fn api(&self, _token: &str, method: &str, path: &str, body: Option<Value>) -> Result<Value> {
        self.calls
            .lock()
            .push((method.into(), path.into(), body.unwrap_or(Value::Null)));
        let answer = self.answers.lock().get(&format!("{method} {path}")).cloned();
        Ok(answer.unwrap_or(Value::Null))
    }

    async fn convert_manifest(&self, code: &str) -> Result<Value> {
        let answer = self.answers.lock().get(&format!("MANIFEST {code}")).cloned();
        match answer {
            Some(app) => Ok(app),
            None => fail_with("O GitHub não reconheceu o código (expirado?)", 422),
        }
    }

    /// Recorded as `APP <method>`; an installation token is always granted.
    async fn app_api(&self, _app_id: i64, pem: &str, method: &str, path: &str, body: Option<Value>) -> Result<Value> {
        if pem.is_empty() {
            return fail_with("Chave privada do GitHub App inválida", 422);
        }
        self.calls
            .lock()
            .push((format!("APP {method}"), path.into(), body.unwrap_or(Value::Null)));
        if let Some(answer) = self.answers.lock().get(&format!("APP {method} {path}")).cloned() {
            return Ok(answer);
        }
        if path.ends_with("/access_tokens") {
            return Ok(json!({ "token": format!("ghs_{path}"), "expires_at": "2999-01-01T00:00:00Z" }));
        }
        Ok(Value::Null)
    }

    async fn job_log(&self, _token: &str, _repo: &str, job_id: u64) -> Result<String> {
        let log = self.answers.lock().get(&format!("LOG {job_id}")).cloned();
        Ok(log.and_then(|l| l.as_str().map(String::from)).unwrap_or_default())
    }
}
