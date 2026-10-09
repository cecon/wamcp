//! Outgoing webhooks: events are queued durably in SQLite and delivered by `deliver_due`
//! (called on a timer) with retries, so a slow receiver never blocks a use case.
use super::core::Core;
use super::event_bus::Envelope;
use super::ports::{Attempt, SendFailure, WebhookSender};
use crate::domain::actor::Actor;
use crate::domain::error::{fail_with, HelpdeskError, Result};
use crate::domain::helpdesk::require_admin;
use crate::domain::model::{Delivery, Webhook, WebhookFields};
use crate::domain::webhooks::{retry_delay, validate_webhook, webhook_event_for, MAX_ATTEMPTS};
use serde_json::json;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

#[derive(Clone)]
pub struct WebhookService {
    pub core: Core,
    pub sender: Arc<dyn WebhookSender>,
    pub delivering: Arc<AtomicBool>,
}

impl WebhookService {
    fn find(&self, id: i64) -> Result<Webhook> {
        self.core
            .repo
            .webhook(id)?
            .ok_or_else(|| HelpdeskError::not_found("Webhook não encontrado").into())
    }

    fn validate(&self, url: &str, subscriptions: &[String], inbox_id: Option<i64>) -> Result<()> {
        validate_webhook(url, subscriptions)?;
        if let Some(inbox_id) = inbox_id {
            if self.core.repo.inbox(inbox_id)?.is_none() {
                return fail_with("Caixa de entrada não encontrada", 422);
            }
        }
        Ok(())
    }

    /// Bus listener: queues one delivery per active, subscribed webhook (filtered by inbox).
    pub fn enqueue(&self, envelope: &Envelope) -> Result<()> {
        let Some(name) = webhook_event_for(&envelope.event) else {
            return Ok(());
        };
        let now = self.core.now();
        for webhook in self.core.repo.webhooks()? {
            if webhook.active == 0 || !webhook.subscriptions.iter().any(|s| s == name) {
                continue;
            }
            if webhook.inbox_id.is_some() && envelope.data["inbox_id"].as_i64() != webhook.inbox_id {
                continue;
            }
            let payload =
                json!({ "event": name, "data": envelope.data, "performer": envelope.performer, "timestamp": now });
            self.core.repo.enqueue_delivery(webhook.id, name, &payload, now)?;
        }
        Ok(())
    }

    pub async fn deliver_due(&self) -> Result<()> {
        if self.delivering.swap(true, Ordering::AcqRel) {
            return Ok(());
        }
        let result = self.deliver_batch().await;
        self.delivering.store(false, Ordering::Release);
        result
    }

    async fn deliver_batch(&self) -> Result<()> {
        for delivery in self.core.repo.due_deliveries(self.core.now(), 20)? {
            let attempts = delivery.attempts + 1;
            let payload = serde_json::from_str(&delivery.payload)?;
            let outcome = self.sender.post(&delivery.url, &payload, &delivery.secret).await;
            let (ok, status, error) = match outcome {
                Ok(status) if (200..300).contains(&status) => (true, Some(i64::from(status)), None),
                Ok(status) => (false, Some(i64::from(status)), Some(format!("HTTP {status}"))),
                Err(SendFailure::Timeout) => (false, None, Some("Tempo esgotado".to_string())),
                Err(SendFailure::Connection) => (false, None, Some("Falha de conexão".to_string())),
            };
            let delay = retry_delay(attempts);
            let now = self.core.now();
            let attempt = Attempt {
                status: if ok {
                    "sent"
                } else if attempts >= MAX_ATTEMPTS || delay.is_none() {
                    "failed"
                } else {
                    "pending"
                },
                attempts,
                next_attempt_at: if ok { now } else { now + delay.unwrap_or(0) },
                response_status: status,
                error,
            };
            self.core.repo.record_attempt(delivery.id, &attempt)?;
        }
        Ok(())
    }

    pub fn list(&self, actor: &Actor) -> Result<Vec<Webhook>> {
        require_admin(actor)?;
        self.core.repo.webhooks()
    }

    pub fn create(&self, actor: &Actor, url: &str, subscriptions: &[String], inbox_id: Option<i64>) -> Result<Webhook> {
        require_admin(actor)?;
        self.validate(url, subscriptions, inbox_id)?;
        self.core
            .repo
            .create_webhook(url, subscriptions, inbox_id, &self.sender.secret())
    }

    pub fn update(&self, actor: &Actor, id: i64, fields: &WebhookFields) -> Result<Webhook> {
        require_admin(actor)?;
        let current = self.find(id)?;
        let url = fields.url.as_deref().unwrap_or(&current.url);
        let subscriptions = fields.subscriptions.as_deref().unwrap_or(&current.subscriptions);
        let inbox_id = fields.inbox_id.unwrap_or(current.inbox_id);
        self.validate(url, subscriptions, inbox_id)?;
        self.core.repo.update_webhook(id, fields)
    }

    pub fn remove(&self, actor: &Actor, id: i64) -> Result<()> {
        require_admin(actor)?;
        self.find(id)?;
        self.core.repo.delete_webhook(id)
    }

    pub fn deliveries(&self, actor: &Actor, id: i64) -> Result<Vec<Delivery>> {
        require_admin(actor)?;
        self.find(id)?;
        self.core.repo.deliveries(id, 20)
    }
}
