use crate::domain::error::Result;
use crate::domain::model::{GithubChannel, Inbox};
use async_trait::async_trait;

/// GitHub inboxes: the repository, its sealed token and webhook secret.
pub trait GithubRepo {
    /// Creates the channel and its `github` inbox.
    fn create_github_inbox(&self, name: &str, channel: &GithubChannel) -> Result<Inbox>;
    fn github_channel(&self, inbox_id: i64) -> Result<Option<GithubChannel>>;
    fn set_github_hook(&self, inbox_id: i64, hook_id: i64) -> Result<()>;
}

/// The GitHub REST API, called with the channel's token.
#[async_trait]
pub trait GithubApi: Send + Sync {
    /// The login of the token's account.
    async fn login(&self, token: &str) -> Result<String>;
    /// Fails when the token cannot read `owner/repo`.
    async fn repository(&self, token: &str, repo: &str) -> Result<()>;
    /// Creates the repository webhook that sends `events` to `url`, signed with `secret`.
    async fn create_hook(&self, token: &str, repo: &str, url: &str, secret: &str, events: &[&str]) -> Result<i64>;
    /// Comments on a pull request or issue; returns the comment's URL.
    async fn comment(&self, token: &str, repo: &str, number: u64, body: &str) -> Result<String>;
}
