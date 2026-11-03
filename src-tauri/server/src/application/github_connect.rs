//! Connecting a GitHub repository: token check, webhook creation (and the report of what happened),
//! kept apart from the webhook receiving so both files stay under the project's 300-line limit.
use super::crypto::random_secret;
use super::helpdesk::HelpdeskService;
use crate::domain::actor::Actor;
use crate::domain::error::{fail_with, Result};
use crate::domain::github::{valid_repo, EVENTS};
use crate::domain::model::{GithubChannel, Inbox};
use serde::Serialize;

/// One step of connecting a repository, answered to the screen that creates the channel: what was
/// checked and what happened, so the administrator sees everything without opening GitHub.
#[derive(Debug, Serialize)]
pub struct GithubCheck {
    pub step: &'static str,
    pub ok: bool,
    pub detail: Option<String>,
}

/// What the administrator needs after connecting: the inbox and the webhook, created by the app or
/// to be added by hand on GitHub when the token cannot create it.
#[derive(Debug, Serialize)]
pub struct GithubConnection {
    pub inbox: Inbox,
    pub webhook_url: String,
    pub webhook_secret: String,
    pub events: Vec<&'static str>,
    pub hook_created: bool,
    pub hook_error: Option<String>,
    /// token → repository → webhook: exactly what happened while creating the channel.
    pub checks: Vec<GithubCheck>,
}

/// Path of a GitHub inbox's webhook, under the app's public address.
pub fn webhook_path(inbox_id: i64) -> String {
    format!("/api/github/{inbox_id}/webhook")
}

pub(super) fn webhook_url(public_url: &str, inbox_id: i64) -> String {
    format!("{}{}", public_url.trim_end_matches('/'), webhook_path(inbox_id))
}

impl HelpdeskService {
    /// Connects `owner/repo` as a new inbox (administrators). The token is checked against GitHub
    /// and stored encrypted, as is the webhook secret.
    pub async fn connect_github(
        &self,
        actor: &Actor,
        name: &str,
        repo: &str,
        token: &str,
        public_url: &str,
    ) -> Result<GithubConnection> {
        if !actor.is_admin() {
            return fail_with("Apenas administradores conectam canais", 403);
        }
        let (name, repo, token) = (name.trim(), repo.trim().trim_matches('/'), token.trim());
        if name.is_empty() || name.chars().count() > 80 || !valid_repo(repo) || token.is_empty() || token.len() > 400 {
            return fail_with("Informe nome, repositório (dono/nome) e token", 422);
        }
        let own_login = match self.github.login(token).await {
            Ok(login) => login,
            Err(error) => {
                return fail_with(
                    format!("Não foi possível autenticar no GitHub com esse token: {error}"),
                    422,
                )
            }
        };
        if let Err(error) = self.github.repository(token, repo).await {
            return fail_with(format!("O token não consegue acessar {repo}: {error}"), 422);
        }
        let token_detail = if own_login.is_empty() {
            "Token válido".to_string()
        } else {
            format!("@{own_login}")
        };
        let secret = random_secret();
        let channel = GithubChannel {
            inbox_id: 0,
            repo: repo.to_string(),
            token: self.secrets.seal(token)?,
            webhook_secret: self.secrets.seal(&secret)?,
            own_login: Some(own_login).filter(|l| !l.is_empty()),
            hook_id: None,
        };
        let inbox = self.core.commit(Some(actor), |_| {
            let inbox = self.core.repo.create_github_inbox(name, &channel)?;
            Ok(inbox)
        })?;
        let webhook_url = webhook_url(public_url, inbox.id);
        let hook_error = self
            .create_github_hook(inbox.id, token, repo, &webhook_url, &secret)
            .await?;
        let hook_created = hook_error.is_none();
        let checks = vec![
            GithubCheck {
                step: "token",
                ok: true,
                detail: Some(token_detail),
            },
            GithubCheck {
                step: "repository",
                ok: true,
                detail: Some(repo.to_string()),
            },
            GithubCheck {
                step: "webhook",
                ok: hook_created,
                detail: Some(
                    hook_error
                        .clone()
                        .unwrap_or_else(|| "Criado no repositório e assinando as entregas".into()),
                ),
            },
        ];
        Ok(GithubConnection {
            inbox,
            webhook_url,
            webhook_secret: secret,
            events: EVENTS.to_vec(),
            hook_created,
            hook_error,
            checks,
        })
    }

    /// Creates the repository webhook and records it; `Some(reason)` when GitHub refuses (usually a
    /// token without the Webhooks permission), so the administrator can fix it and try again.
    pub(super) async fn create_github_hook(
        &self,
        inbox_id: i64,
        token: &str,
        repo: &str,
        url: &str,
        secret: &str,
    ) -> Result<Option<String>> {
        match self.github.create_hook(token, repo, url, secret, &EVENTS).await {
            Ok(hook_id) => {
                self.core.repo.set_github_hook(inbox_id, hook_id)?;
                Ok(None)
            }
            Err(error) => Ok(Some(error.to_string())),
        }
    }
}
