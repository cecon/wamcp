use crate::domain::error::Result;
use crate::domain::model::{GithubApp, GithubChannel, Inbox};
use async_trait::async_trait;
use serde_json::Value;

/// GitHub inboxes: the repository, its sealed token and webhook secret.
pub trait GithubRepo {
    /// Creates the channel and its `github` inbox.
    fn create_github_inbox(&self, name: &str, channel: &GithubChannel) -> Result<Inbox>;
    fn github_channel(&self, inbox_id: i64) -> Result<Option<GithubChannel>>;
    fn set_github_hook(&self, inbox_id: i64, hook_id: i64) -> Result<()>;
    /// Replaces the (sealed) token of a token-connected channel and the account it acts as.
    fn set_github_token(&self, inbox_id: i64, token: &str, own_login: Option<&str>) -> Result<()>;
    /// Every GitHub inbox's channel.
    fn github_channels(&self) -> Result<Vec<GithubChannel>>;
    /// The channel of `owner/repo` (GitHub's case is not always the one typed).
    fn github_channel_by_repo(&self, repo: &str) -> Result<Option<GithubChannel>>;
    /// Links a channel to an installation of the GitHub App, or unlinks it with `None`.
    fn set_github_installation(&self, inbox_id: i64, installation_id: Option<i64>) -> Result<()>;
    fn github_app(&self) -> Result<Option<GithubApp>>;
    /// Stores the GitHub App, replacing the previous one.
    fn save_github_app(&self, app: &GithubApp) -> Result<()>;
    /// Records an App creation on its way to GitHub (and forgets the expired ones).
    fn save_github_manifest(&self, state: &str, owner: Option<&str>, until: i64, now: i64) -> Result<()>;
    /// The live creation of `state`: `Some(owner)`, where the owner is the organization or `None`.
    fn github_manifest(&self, state: &str, now: i64) -> Result<Option<Option<String>>>;
    fn drop_github_manifest(&self, state: &str) -> Result<()>;
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
    /// Any call of the REST API: `method` is GET, POST, PUT, PATCH or DELETE and `path` starts at
    /// `/repos/…`. Answers the response body (`null` when GitHub sends none).
    async fn api(&self, token: &str, method: &str, path: &str, body: Option<Value>) -> Result<Value>;
    /// Exchanges the code of a GitHub App manifest for the App (id, slug, pem, webhook_secret…).
    async fn convert_manifest(&self, code: &str) -> Result<Value>;
    /// A call of the REST API as the GitHub App itself (a JWT signed with its private key, PEM).
    async fn app_api(&self, app_id: i64, pem: &str, method: &str, path: &str, body: Option<Value>) -> Result<Value>;
    /// The plain-text log of one GitHub Actions job.
    async fn job_log(&self, token: &str, repo: &str, job_id: u64) -> Result<String>;
}
