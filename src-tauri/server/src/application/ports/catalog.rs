use crate::domain::error::Result;
use crate::domain::model::{
    Action, AutomationRule, CannedResponse, Condition, CsatEntry, CsatResponse, Delivery, DueDelivery,
    Label, LabelFields, Notification, ReportingEvent, RuleFields, Webhook, WebhookFields,
};
use serde_json::Value;

/// Labels, canned responses and per-agent notifications.
pub trait CatalogRepo {
    fn labels(&self) -> Result<Vec<Label>>;
    fn label(&self, id: i64) -> Result<Option<Label>>;
    fn label_by_title(&self, title: &str, except_id: i64) -> Result<Option<Label>>;
    fn labels_by_titles(&self, titles: &[String]) -> Result<Vec<Label>>;
    fn create_label(&self, title: &str, fields: &LabelFields) -> Result<Label>;
    fn update_label(&self, id: i64, title: Option<&str>, fields: &LabelFields) -> Result<Label>;
    fn delete_label(&self, id: i64) -> Result<()>;

    fn canned_responses(&self, q: &str) -> Result<Vec<CannedResponse>>;
    fn canned_response(&self, id: i64) -> Result<Option<CannedResponse>>;
    fn canned_by_code(&self, code: &str, except_id: i64) -> Result<Option<CannedResponse>>;
    fn create_canned(&self, code: &str, content: &str) -> Result<CannedResponse>;
    fn update_canned(&self, id: i64, code: Option<&str>, content: Option<&str>) -> Result<CannedResponse>;
    fn delete_canned(&self, id: i64) -> Result<()>;

    fn create_notification(
        &self,
        user_id: i64,
        kind: &str,
        conversation_id: i64,
        actor_user_id: Option<i64>,
        created_at: i64,
    ) -> Result<Notification>;
    fn notifications(&self, user_id: i64, limit: i64) -> Result<Vec<Notification>>;
    fn unread_notifications(&self, user_id: i64) -> Result<i64>;
    /// Number of notifications marked (0 when it does not belong to the user).
    fn read_notification(&self, user_id: i64, id: i64, at: i64) -> Result<usize>;
    fn read_all_notifications(&self, user_id: i64, at: i64) -> Result<()>;
}

/// Outgoing webhooks (with a durable delivery queue) and automation rules.
pub trait AutomationRepo {
    fn webhooks(&self) -> Result<Vec<Webhook>>;
    fn webhook(&self, id: i64) -> Result<Option<Webhook>>;
    fn create_webhook(&self, url: &str, subscriptions: &[String], inbox_id: Option<i64>, secret: &str) -> Result<Webhook>;
    fn update_webhook(&self, id: i64, fields: &WebhookFields) -> Result<Webhook>;
    fn delete_webhook(&self, id: i64) -> Result<()>;
    fn enqueue_delivery(&self, webhook_id: i64, event: &str, payload: &Value, now: i64) -> Result<()>;
    fn due_deliveries(&self, now: i64, limit: i64) -> Result<Vec<DueDelivery>>;
    fn record_attempt(&self, id: i64, attempt: &Attempt) -> Result<()>;
    fn deliveries(&self, webhook_id: i64, limit: i64) -> Result<Vec<Delivery>>;

    fn automation_rules(&self) -> Result<Vec<AutomationRule>>;
    fn active_rules(&self, event_name: &str) -> Result<Vec<AutomationRule>>;
    fn automation_rule(&self, id: i64) -> Result<Option<AutomationRule>>;
    fn create_rule(&self, rule: &NewRule) -> Result<AutomationRule>;
    fn update_rule(&self, id: i64, fields: &RuleFields) -> Result<AutomationRule>;
    fn delete_rule(&self, id: i64) -> Result<()>;
}

/// The outcome of one webhook delivery attempt.
#[derive(Debug, Clone, PartialEq)]
pub struct Attempt {
    pub status: &'static str,
    pub attempts: i64,
    pub next_attempt_at: i64,
    pub response_status: Option<i64>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct NewRule {
    pub name: String,
    pub description: Option<String>,
    pub event_name: String,
    pub conditions: Vec<Condition>,
    pub actions: Vec<Action>,
    pub active: bool,
}

/// A reporting period: `[since, until)` in epoch seconds, optionally for one inbox.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Period {
    pub since: i64,
    pub until: i64,
    pub inbox_id: Option<i64>,
}

/// Working hours, CSAT responses and reporting events/aggregates.
pub trait InsightsRepo {
    fn create_csat(&self, csat: &CsatResponse) -> Result<CsatResponse>;
    fn csat_responses(&self, period: &Period) -> Result<Vec<CsatEntry>>;
    /// first_response is recorded at most once per conversation.
    fn record_event(&self, event: &ReportingEvent) -> Result<()>;
    fn first_incoming_at(&self, conversation_id: i64) -> Result<Option<i64>>;
    fn summary(&self, period: &Period) -> Result<Value>;
    fn agent_report(&self, period: &Period) -> Result<Vec<Value>>;
}
