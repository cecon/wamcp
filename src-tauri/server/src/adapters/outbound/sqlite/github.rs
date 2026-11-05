use super::db::{int, iso, now_ms, opt_int, opt_text, text, SqliteStore, PLAIN};
use crate::application::ports::{GithubRepo, InboxRepo};
use crate::domain::error::{Error, Result};
use crate::domain::model::{GithubApp, GithubChannel, Inbox};

impl GithubRepo for SqliteStore {
    fn create_github_inbox(&self, name: &str, channel: &GithubChannel) -> Result<Inbox> {
        let created = iso(now_ms());
        let channel_id = self.insert(
            "INSERT INTO channel_github(repo,token,webhook_secret,own_login,created) VALUES(?,?,?,?,?)",
            vec![
                text(channel.repo.as_str()),
                text(channel.token.as_str()),
                text(channel.webhook_secret.as_str()),
                opt_text(channel.own_login.as_deref()),
                text(created.as_str()),
            ],
        )?;
        let id = self.insert(
            "INSERT INTO inboxes(name,channel_type,channel_id,created) VALUES(?,'github',?,?)",
            vec![text(name), int(channel_id), text(created)],
        )?;
        self.inbox(id)?.ok_or_else(|| Error::internal("github inbox vanished"))
    }

    fn github_channel(&self, inbox_id: i64) -> Result<Option<GithubChannel>> {
        let sql = "SELECT i.id AS inbox_id,g.repo,g.token,g.webhook_secret,g.own_login,g.hook_id,g.installation_id
                   FROM inboxes i JOIN channel_github g ON g.id=i.channel_id
                   WHERE i.channel_type='github' AND i.id=?";
        self.row(sql, vec![int(inbox_id)], PLAIN)
    }

    fn set_github_hook(&self, inbox_id: i64, hook_id: i64) -> Result<()> {
        let sql = "UPDATE channel_github SET hook_id=?
                   WHERE id=(SELECT channel_id FROM inboxes WHERE id=? AND channel_type='github')";
        self.exec(sql, vec![int(hook_id), int(inbox_id)]).map(|_| ())
    }

    fn github_channels(&self) -> Result<Vec<GithubChannel>> {
        let sql = "SELECT i.id AS inbox_id,g.repo,g.token,g.webhook_secret,g.own_login,g.hook_id,g.installation_id
                   FROM inboxes i JOIN channel_github g ON g.id=i.channel_id
                   WHERE i.channel_type='github' ORDER BY i.id";
        self.rows(sql, vec![], PLAIN)
    }

    fn github_channel_by_repo(&self, repo: &str) -> Result<Option<GithubChannel>> {
        let sql = "SELECT i.id AS inbox_id,g.repo,g.token,g.webhook_secret,g.own_login,g.hook_id,g.installation_id
                   FROM inboxes i JOIN channel_github g ON g.id=i.channel_id
                   WHERE i.channel_type='github' AND g.repo=? COLLATE NOCASE";
        self.row(sql, vec![text(repo)], PLAIN)
    }

    fn set_github_installation(&self, inbox_id: i64, installation_id: Option<i64>) -> Result<()> {
        let sql = "UPDATE channel_github SET installation_id=?
                   WHERE id=(SELECT channel_id FROM inboxes WHERE id=? AND channel_type='github')";
        self.exec(sql, vec![opt_int(installation_id), int(inbox_id)])
            .map(|_| ())
    }

    fn github_app(&self) -> Result<Option<GithubApp>> {
        let sql = "SELECT app_id,slug,html_url,owner,private_key,webhook_secret FROM github_app WHERE id=1";
        self.row(sql, vec![], PLAIN)
    }

    fn save_github_app(&self, app: &GithubApp) -> Result<()> {
        let sql = "INSERT OR REPLACE INTO github_app(id,app_id,slug,html_url,owner,private_key,webhook_secret,created)
                   VALUES(1,?,?,?,?,?,?,?)";
        let params = vec![
            int(app.app_id),
            text(app.slug.as_str()),
            text(app.html_url.as_str()),
            opt_text(app.owner.as_deref()),
            text(app.private_key.as_str()),
            text(app.webhook_secret.as_str()),
            text(iso(now_ms())),
        ];
        self.exec(sql, params).map(|_| ())
    }
}
