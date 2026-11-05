//! The repository hook of a GitHub inbox connected with a token: creating it (again) and what the
//! administrator needs to add it by hand. Inboxes of the GitHub App need neither.
use super::github::webhook_url;
use super::helpdesk::HelpdeskService;
use crate::domain::actor::Actor;
use crate::domain::error::{fail_with, Result};
use crate::domain::github::EVENTS;
use serde_json::{json, Value};

impl HelpdeskService {
    /// Creates the repository webhook and records it; `Some(reason)` when GitHub refuses (usually a
    /// token without the Webhooks permission), so the administrator can fix it and try again.
    pub(crate) async fn create_github_hook(
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

    /// Tries again to create the webhook of a GitHub inbox that has none (administrators), with the
    /// stored token. Answers the setup, with `hook_error` when GitHub still refuses.
    pub async fn retry_github_hook(&self, actor: &Actor, inbox_id: i64, public_url: &str) -> Result<Value> {
        let mut setup = self.github_setup(actor, inbox_id, public_url)?;
        if setup["hook_created"] == true {
            return Ok(setup);
        }
        let Some(channel) = self.core.repo.github_channel(inbox_id)? else {
            return fail_with("Canal do GitHub não encontrado", 404);
        };
        let token = self.secrets.open(&channel.token)?;
        let secret = self.secrets.open(&channel.webhook_secret)?;
        let url = webhook_url(public_url, inbox_id);
        let hook_error = self
            .create_github_hook(inbox_id, &token, &channel.repo, &url, &secret)
            .await?;
        setup["hook_created"] = json!(hook_error.is_none());
        setup["hook_error"] = json!(hook_error);
        Ok(setup)
    }

    /// The webhook of a GitHub inbox, to add it on GitHub by hand (administrators).
    pub fn github_setup(&self, actor: &Actor, inbox_id: i64, public_url: &str) -> Result<Value> {
        if !actor.is_admin() {
            return fail_with("Apenas administradores veem a configuração do canal", 403);
        }
        let Some(channel) = self.core.repo.github_channel(inbox_id)? else {
            return fail_with("Canal do GitHub não encontrado", 404);
        };
        Ok(json!({
            "repo": channel.repo,
            "account": match (channel.installation_id, self.core.repo.github_app()?) {
                (Some(_), Some(app)) => Some(format!("{}[bot]", app.slug)),
                _ => channel.own_login,
            },
            "webhook_url": webhook_url(public_url, inbox_id),
            "webhook_secret": match channel.installation_id {
                Some(_) => String::new(),
                None => self.secrets.open(&channel.webhook_secret)?,
            },
            "events": EVENTS,
            "hook_created": channel.hook_id.is_some() || channel.installation_id.is_some(),
            "via_app": channel.installation_id.is_some(),
        }))
    }
}
