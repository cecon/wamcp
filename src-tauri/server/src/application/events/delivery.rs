//! Publishing and delivery: queue events for matching subscriptions and deliver them with retries.
use super::{owner_of, unavailable, EventService};
use crate::application::crypto::sha256_hex;
use crate::application::ports::QueueItem;
use crate::domain::events::{message_event, retryable};
use crate::domain::model::WaMessage;
use futures::StreamExt;
use serde_json::Value;
use std::sync::atomic::Ordering;

impl EventService {
    /// Queues the event for every matching subscription of the session; returns how many.
    pub fn publish(&self, session_id: &str, message: &WaMessage) -> usize {
        if self.0.closed.load(Ordering::Acquire) {
            return 0;
        }
        let Some(event) = message_event(session_id, message, sha256_hex) else {
            return 0;
        };
        if self.prune().is_err() {
            return 0;
        }
        let jid = event["data"]["jid"].as_str().unwrap_or_default();
        let subscriptions = self.0.repo.subscriptions(Some(session_id)).unwrap_or_default();
        subscriptions
            .iter()
            .filter(|s| {
                s.args
                    .get("jid")
                    .and_then(Value::as_str)
                    .is_none_or(|filter| filter == jid)
            })
            .filter(|s| self.0.repo.enqueue(s, &event, self.now()).unwrap_or(false))
            .count()
    }

    /// Delivers due events: one at a time per subscription, up to four subscriptions in parallel.
    pub async fn flush(&self) {
        if self.0.closed.load(Ordering::Acquire) {
            return;
        }
        let _flushing = self.0.flushing.lock().await;
        if self.prune().is_err() {
            return;
        }
        let pending = self.0.repo.due(self.now(), 20).unwrap_or_default();
        futures::stream::iter(pending)
            .for_each_concurrent(4, |item| async move {
                let id = item.subscription_id.clone();
                let _ = self
                    .serial(&id, async { self.deliver(item).await.map_err(unavailable) })
                    .await;
            })
            .await;
    }

    async fn deliver(&self, item: QueueItem) -> crate::domain::error::Result<()> {
        let repo = &self.0.repo;
        let Some(mut subscription) = repo.subscription(&item.subscription_id)? else {
            return Ok(());
        };
        if !repo.has_pending(&item)? {
            return Ok(());
        }
        let closed = self.0.closed.load(Ordering::Acquire);
        if closed || subscription.expires <= self.now() || !self.allowed(&owner_of(&subscription)) {
            if !closed {
                repo.remove_subscription(&subscription.id)?;
            }
            return Ok(());
        }
        if subscription.rotate_until.is_some_and(|until| until <= self.now()) {
            subscription.previous_secret = None;
            subscription.rotate_until = None;
        }
        let mut secrets = vec![subscription.secret.clone()];
        secrets.extend(subscription.previous_secret.clone());
        let response = self
            .0
            .callback
            .deliver(&subscription.url, &subscription.id, &secrets, &item.event)
            .await;
        if !self.allowed(&owner_of(&subscription)) || subscription.expires <= self.now() {
            return repo.remove_subscription(&subscription.id);
        }
        let status = response.map(|r| r.status).unwrap_or(0);
        let success = (200..300).contains(&status);
        let terminal = !retryable(Some(status)) || item.attempts >= 7;
        let outcome = match (success, status, terminal) {
            (true, _, _) => "delivered",
            (_, 410, _) => "disabled",
            (_, _, true) => "discarded",
            _ => "retry",
        };
        repo.record(&item, i64::from(status), outcome, self.now())?;
        if status == 410 {
            repo.remove_subscription(&subscription.id)
        } else if success || terminal {
            repo.finish(&item)
        } else {
            let delay = 1000_i64.saturating_mul(1 << item.attempts.clamp(0, 20)).min(300_000);
            repo.retry(&item, self.now() + delay)
        }
    }
}
