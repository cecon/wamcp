//! The app's own GitHub App: an identity (`name[bot]`) for the agents of GitHub inboxes. The
//! administrator creates it from a manifest (GitHub fills in name, permissions and webhook, the
//! administrator only confirms) and installs it on repositories; each repository of an
//! installation becomes a GitHub inbox. Its single webhook brings the events of every repository,
//! and the agent acts with installation tokens that last an hour and are renewed here.
use super::crypto::random_secret;
use super::helpdesk::HelpdeskService;
use crate::domain::actor::Actor;
use crate::domain::error::{fail, fail_with, Result};
use crate::domain::github::{valid_repo, EVENTS};
use crate::domain::model::{GithubApp, GithubChannel};
use serde_json::{json, Value};

/// How long the administrator has to confirm the App on GitHub.
const MANIFEST_MS: i64 = 15 * 60 * 1000;
/// An installation token is renewed this long before it expires.
const TOKEN_MARGIN_MS: i64 = 5 * 60 * 1000;

/// What the agent may do on the repositories it is installed on.
fn permissions() -> Value {
    json!({
        "contents": "write", "pull_requests": "write", "issues": "write", "actions": "write",
        "checks": "read", "statuses": "read", "metadata": "read",
    })
}

/// The App GitHub creates from it. The webhook secret is chosen by GitHub and comes back in the
/// conversion, with the private key.
pub fn manifest(public_url: &str, name: &str) -> Value {
    let base = public_url.trim_end_matches('/');
    json!({
        "name": name,
        "url": base,
        "description": "Agente de IA do WA MCP: acompanha pull requests, issues e o CI e se posiciona.",
        "hook_attributes": { "url": format!("{base}/api/github/app/webhook"), "active": true },
        "redirect_url": format!("{base}/api/github/app/callback"),
        "setup_url": format!("{base}/app/"),
        "setup_on_update": true,
        "public": false,
        "default_permissions": permissions(),
        "default_events": EVENTS,
    })
}

impl HelpdeskService {
    /// Starts creating the GitHub App (administrators): the page to open, which sends the manifest
    /// to GitHub. `owner` is an organization; without it the App belongs to the person's account.
    pub fn start_github_app(&self, actor: &Actor, owner: Option<&str>, public_url: &str) -> Result<Value> {
        if !actor.is_admin() {
            return fail_with("Apenas administradores criam o GitHub App", 403);
        }
        let owner = owner.map(str::trim).filter(|o| !o.is_empty());
        if owner.is_some_and(|o| !valid_repo(&format!("{o}/x"))) {
            return fail_with("Organização inválida", 422);
        }
        let state = random_secret();
        let until = self.core.clock.now_ms() + MANIFEST_MS;
        let mut runs = self.github_runs.lock();
        let now = self.core.clock.now_ms();
        runs.manifests.retain(|_, (until, _)| *until > now);
        runs.manifests.insert(state.clone(), (until, owner.map(String::from)));
        let base = public_url.trim_end_matches('/');
        Ok(json!({ "url": format!("{base}/api/github/app/new?state={state}") }))
    }

    /// The form that posts the manifest to GitHub: its address and the manifest, for a live state.
    pub fn github_app_form(&self, state: &str, public_url: &str) -> Result<(String, String)> {
        let now = self.core.clock.now_ms();
        let owner = match self.github_runs.lock().manifests.get(state) {
            Some((until, owner)) if *until > now => owner.clone(),
            _ => return fail_with("Link expirado: comece de novo pelo app", 410),
        };
        let action = match &owner {
            Some(org) => format!("https://github.com/organizations/{org}/settings/apps/new?state={state}"),
            None => format!("https://github.com/settings/apps/new?state={state}"),
        };
        let suffix: String = random_secret().chars().take(6).collect();
        let name = format!("wamcp-agente-{}", suffix.to_ascii_lowercase());
        Ok((action, manifest(public_url, &name).to_string()))
    }

    /// GitHub came back with the App: stores it (key and secret sealed) and answers where to install it.
    pub async fn finish_github_app(&self, state: &str, code: &str) -> Result<String> {
        let now = self.core.clock.now_ms();
        match self.github_runs.lock().manifests.remove(state) {
            Some((until, _)) if until > now => {}
            _ => return fail_with("Link expirado: comece de novo pelo app", 410),
        }
        let created = self.github.convert_manifest(code).await?;
        let (Some(app_id), Some(slug), Some(pem), Some(secret)) = (
            created["id"].as_i64(),
            created["slug"].as_str(),
            created["pem"].as_str(),
            created["webhook_secret"].as_str(),
        ) else {
            return fail("O GitHub não devolveu o App completo");
        };
        let html_url = created["html_url"].as_str().unwrap_or_default().to_string();
        let app = GithubApp {
            app_id,
            slug: slug.into(),
            html_url: html_url.clone(),
            owner: created["owner"]["login"].as_str().map(String::from),
            private_key: self.secrets.seal(pem)?,
            webhook_secret: self.secrets.seal(secret)?,
        };
        self.core.repo.save_github_app(&app)?;
        self.github_runs.lock().tokens.clear();
        Ok(format!("{html_url}/installations/new"))
    }

    /// The GitHub App and the repositories it serves (administrators).
    pub fn github_app_status(&self, actor: &Actor) -> Result<Value> {
        if !actor.is_admin() {
            return fail_with("Apenas administradores veem o GitHub App", 403);
        }
        let Some(app) = self.core.repo.github_app()? else {
            return Ok(json!({ "app": null, "repos": [] }));
        };
        let repos: Vec<Value> = self
            .core
            .repo
            .github_channels()?
            .into_iter()
            .filter(|c| c.installation_id.is_some())
            .map(|c| json!({ "inbox_id": c.inbox_id, "repo": c.repo }))
            .collect();
        Ok(json!({
            "app": { "slug": app.slug, "owner": app.owner, "html_url": app.html_url,
                     "install_url": format!("{}/installations/new", app.html_url) },
            "repos": repos,
        }))
    }

    /// The credential for `channel`'s repository: an installation token of the GitHub App (cached
    /// until shortly before it expires) or the token the administrator pasted.
    pub async fn github_token(&self, channel: &GithubChannel) -> Result<String> {
        let Some(installation) = channel.installation_id else {
            return self.secrets.open(&channel.token);
        };
        let now = self.core.clock.now_ms();
        if let Some((token, until)) = self.github_runs.lock().tokens.get(&installation) {
            if *until > now + TOKEN_MARGIN_MS {
                return Ok(token.clone());
            }
        }
        let path = format!("/app/installations/{installation}/access_tokens");
        let granted = self.app_call("POST", &path).await?;
        let Some(token) = granted["token"].as_str().map(String::from) else {
            return fail("O GitHub não entregou o token de instalação");
        };
        let until = granted["expires_at"]
            .as_str()
            .and_then(|at| chrono::DateTime::parse_from_rfc3339(at).ok())
            .map_or(now + 50 * 60 * 1000, |at| at.timestamp_millis());
        self.github_runs
            .lock()
            .tokens
            .insert(installation, (token.clone(), until));
        Ok(token)
    }

    /// A call of the API as the GitHub App itself.
    pub(crate) async fn app_call(&self, method: &str, path: &str) -> Result<Value> {
        let Some(app) = self.core.repo.github_app()? else {
            return fail_with("O GitHub App ainda não foi criado", 422);
        };
        let pem = self.secrets.open(&app.private_key)?;
        self.github.app_api(app.app_id, &pem, method, path, None).await
    }
}
