//! The GitHub App's webhook: one address for every repository the App is installed on. Installing
//! the App on a repository (or adding the repository to the installation) makes it a GitHub inbox;
//! removing it unlinks the inbox, which keeps its conversations. Other events go to the inbox of
//! their repository, exactly like a repository hook's.
use super::crypto::valid_hub_signature;
use super::helpdesk::HelpdeskService;
use crate::domain::actor::Actor;
use crate::domain::error::{fail_with, Result};
use crate::domain::github::valid_repo;
use crate::domain::model::GithubChannel;
use serde_json::Value;

fn names(list: &Value) -> Vec<&str> {
    list.as_array()
        .into_iter()
        .flatten()
        .filter_map(|r| r["full_name"].as_str())
        .collect()
}

impl HelpdeskService {
    /// One delivery of the App's webhook, signed with the App's secret.
    pub fn receive_github_app(&self, event: &str, delivery: &str, signature: &str, body: &[u8]) -> Result<()> {
        let Some(app) = self.core.repo.github_app()? else {
            return fail_with("GitHub App não configurado", 404);
        };
        let secret = self.secrets.open(&app.webhook_secret)?;
        if !valid_hub_signature(&secret, body, signature) {
            return fail_with("Assinatura inválida", 401);
        }
        let Ok(payload) = serde_json::from_slice::<Value>(body) else {
            return fail_with("Corpo inválido", 400);
        };
        let Some(installation) = payload["installation"]["id"].as_i64() else {
            return Ok(());
        };
        let bot = format!("{}[bot]", app.slug);
        let action = payload["action"].as_str().unwrap_or_default();
        match (event, action) {
            ("installation", "deleted" | "suspend") => self.unlink_installation(installation),
            ("installation", _) => self.link_repos(installation, &names(&payload["repositories"]), &bot),
            ("installation_repositories", _) => {
                self.link_repos(installation, &names(&payload["repositories_added"]), &bot)?;
                for repo in names(&payload["repositories_removed"]) {
                    if let Some(channel) = self.core.repo.github_channel_by_repo(repo)? {
                        self.core.repo.set_github_installation(channel.inbox_id, None)?;
                    }
                }
                Ok(())
            }
            _ => {
                let repo = payload["repository"]["full_name"].as_str().unwrap_or_default();
                if !valid_repo(repo) {
                    return Ok(());
                }
                let channel = self.app_channel(installation, repo, &bot)?;
                self.ingest_github(&channel, event, delivery, &payload).map(|_| ())
            }
        }
    }

    fn link_repos(&self, installation: i64, repos: &[&str], bot: &str) -> Result<()> {
        for repo in repos.iter().filter(|r| valid_repo(r)) {
            self.app_channel(installation, repo, bot)?;
        }
        Ok(())
    }

    /// The inbox of `repo`, linked to the installation; created (named after the repository) when
    /// the repository had none.
    fn app_channel(&self, installation: i64, repo: &str, bot: &str) -> Result<GithubChannel> {
        let store = &self.core.repo;
        if let Some(mut channel) = store.github_channel_by_repo(repo)? {
            if channel.installation_id != Some(installation) {
                store.set_github_installation(channel.inbox_id, Some(installation))?;
                channel.installation_id = Some(installation);
                self.github_runs.lock().tokens.remove(&installation);
            }
            return Ok(channel);
        }
        let mut channel = GithubChannel {
            inbox_id: 0,
            repo: repo.to_string(),
            token: String::new(),
            webhook_secret: String::new(),
            own_login: Some(bot.to_string()),
            hook_id: None,
            installation_id: Some(installation),
        };
        let inbox = self
            .core
            .commit(Some(&Actor::system("github_app", "GitHub App")), |_| {
                let inbox = store.create_github_inbox(repo, &channel)?;
                store.set_github_installation(inbox.id, Some(installation))?;
                Ok(inbox)
            })?;
        channel.inbox_id = inbox.id;
        Ok(channel)
    }

    fn unlink_installation(&self, installation: i64) -> Result<()> {
        for channel in self.core.repo.github_channels()? {
            if channel.installation_id == Some(installation) {
                self.core.repo.set_github_installation(channel.inbox_id, None)?;
            }
        }
        self.github_runs.lock().tokens.remove(&installation);
        Ok(())
    }
}
