//! Deliveries GitHub could not hand to the app (app closed, tunnel down) are lost: GitHub does not
//! try again by itself. Every few minutes the app reads each webhook's recent deliveries (GitHub
//! keeps three days) and asks GitHub to send the failed ones again; they arrive through the
//! webhook as usual and the delivery ID keeps them from being stored twice.
use super::helpdesk::HelpdeskService;
use crate::domain::error::Result;
use crate::domain::model::GithubChannel;
use serde_json::Value;
use std::collections::HashMap;
use std::time::Duration;
use tokio::task::JoinHandle;

/// A delivery that failed this many times (the first try included) is left alone.
const MAX_ATTEMPTS: usize = 4;

/// The delivery IDs to send again, oldest first: every attempt failed, there were fewer than
/// [`MAX_ATTEMPTS`] and `stored` says the event did not reach the inbox some other way.
pub fn to_redeliver(deliveries: &[Value], stored: impl Fn(&str) -> bool) -> Vec<i64> {
    // guid → (oldest attempt's id, attempts, any succeeded)
    let mut by_guid: HashMap<&str, (i64, usize, bool)> = HashMap::new();
    for delivery in deliveries {
        let (Some(guid), Some(id)) = (delivery["guid"].as_str(), delivery["id"].as_i64()) else {
            continue;
        };
        let ok = delivery["status_code"]
            .as_u64()
            .is_some_and(|code| (200..300).contains(&code));
        let entry = by_guid.entry(guid).or_insert((id, 0, false));
        entry.0 = entry.0.min(id);
        entry.1 += 1;
        entry.2 |= ok;
    }
    let mut ids: Vec<i64> = by_guid
        .into_iter()
        .filter(|(guid, (_, attempts, ok))| !ok && *attempts < MAX_ATTEMPTS && !stored(guid))
        .map(|(_, (id, _, _))| id)
        .collect();
    ids.sort_unstable();
    ids
}

impl HelpdeskService {
    /// Asks GitHub to send again the failed deliveries of every GitHub inbox with a webhook.
    /// Answers how many were asked for; a channel GitHub refuses is skipped.
    pub async fn redeliver_github(&self) -> Result<usize> {
        let mut asked = 0;
        for channel in self.core.repo.github_channels()? {
            match self.redeliver_channel(&channel).await {
                Ok(count) => asked += count,
                Err(error) => tracing::warn!(%error, repo = %channel.repo, "entregas do GitHub não recuperadas"),
            }
        }
        Ok(asked)
    }

    /// The periodic job: a minute after start (the tunnel comes up after the server), then every
    /// 10 minutes.
    pub fn spawn_github_redelivery(&self) -> JoinHandle<()> {
        let this = self.clone();
        tokio::spawn(async move {
            let start = tokio::time::Instant::now() + Duration::from_secs(60);
            let mut ticker = tokio::time::interval_at(start, Duration::from_secs(600));
            loop {
                ticker.tick().await;
                let _ = this.redeliver_github().await;
            }
        })
    }

    async fn redeliver_channel(&self, channel: &GithubChannel) -> Result<usize> {
        let Some(hook_id) = channel.hook_id else {
            return Ok(0);
        };
        let token = self.secrets.open(&channel.token)?;
        let hook = format!("/repos/{}/hooks/{hook_id}/deliveries", channel.repo);
        let list = self
            .github
            .api(&token, "GET", &format!("{hook}?per_page=100"), None)
            .await?;
        let deliveries = list.as_array().cloned().unwrap_or_default();
        let repo = &self.core.repo;
        let stored = |guid: &str| {
            repo.message_by_source(channel.inbox_id, &format!("github:{guid}"))
                .is_ok_and(|m| m.is_some())
        };
        let ids = to_redeliver(&deliveries, stored);
        for id in &ids {
            self.github
                .api(&token, "POST", &format!("{hook}/{id}/attempts"), None)
                .await?;
        }
        Ok(ids.len())
    }
}
