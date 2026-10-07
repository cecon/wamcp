use super::db::{flag, int, iso, now_ms, opt_int, opt_text, text, Shape, SqliteStore, PLAIN};
use crate::application::ports::{Attempt, AutomationRepo, NewRule};
use crate::domain::error::{Error, Result};
use crate::domain::model::{AutomationRule, Delivery, DueDelivery, RuleFields, Webhook, WebhookFields};
use rusqlite::types::Value as Sql;
use serde_json::Value;

const WEBHOOK: Shape = Shape { json: &["subscriptions"], bools: &[] };
const RULE: Shape = Shape { json: &["conditions", "actions"], bools: &[] };

fn json_text(value: &impl serde::Serialize) -> Result<Sql> {
    Ok(text(serde_json::to_string(value)?))
}

impl AutomationRepo for SqliteStore {
    fn webhooks(&self) -> Result<Vec<Webhook>> {
        self.rows("SELECT * FROM webhooks ORDER BY id", vec![], WEBHOOK)
    }

    fn webhook(&self, id: i64) -> Result<Option<Webhook>> {
        self.row("SELECT * FROM webhooks WHERE id=?", vec![int(id)], WEBHOOK)
    }

    fn create_webhook(&self, url: &str, subscriptions: &[String], inbox_id: Option<i64>, secret: &str) -> Result<Webhook> {
        let id = self.insert(
            "INSERT INTO webhooks(url,subscriptions,inbox_id,secret,created) VALUES(?,?,?,?,?)",
            vec![text(url), json_text(&subscriptions)?, opt_int(inbox_id), text(secret), text(iso(now_ms()))],
        )?;
        self.webhook(id)?.ok_or_else(|| Error::internal("webhook vanished"))
    }

    fn update_webhook(&self, id: i64, fields: &WebhookFields) -> Result<Webhook> {
        let mut changes: Vec<(&str, Sql)> = Vec::new();
        if let Some(url) = &fields.url {
            changes.push(("url", text(url.as_str())));
        }
        if let Some(subscriptions) = &fields.subscriptions {
            changes.push(("subscriptions", json_text(subscriptions)?));
        }
        if let Some(inbox) = fields.inbox_id {
            changes.push(("inbox_id", opt_int(inbox)));
        }
        if let Some(active) = fields.active {
            changes.push(("active", flag(active)));
        }
        self.update_fields("webhooks", int(id), changes)?;
        self.webhook(id)?.ok_or_else(|| Error::internal("webhook vanished"))
    }

    fn delete_webhook(&self, id: i64) -> Result<()> {
        self.exec("DELETE FROM webhooks WHERE id=?", vec![int(id)]).map(drop)
    }

    fn enqueue_delivery(&self, webhook_id: i64, event: &str, payload: &Value, now: i64) -> Result<()> {
        let sql = "INSERT INTO webhook_deliveries(webhook_id,event,payload,next_attempt_at,created_at) VALUES(?,?,?,?,?)";
        self.exec(sql, vec![int(webhook_id), text(event), text(payload.to_string()), int(now), int(now)]).map(drop)
    }

    fn due_deliveries(&self, now: i64, limit: i64) -> Result<Vec<DueDelivery>> {
        let sql = "SELECT d.*, w.url, w.secret FROM webhook_deliveries d JOIN webhooks w ON w.id=d.webhook_id
                   WHERE d.status='pending' AND d.next_attempt_at<=? AND w.active=1 ORDER BY d.id LIMIT ?";
        self.rows(sql, vec![int(now), int(limit)], PLAIN)
    }

    fn record_attempt(&self, id: i64, a: &Attempt) -> Result<()> {
        let sql = "UPDATE webhook_deliveries SET status=?,attempts=?,next_attempt_at=?,response_status=?,last_error=? WHERE id=?";
        let params = vec![
            text(a.status),
            int(a.attempts),
            int(a.next_attempt_at),
            opt_int(a.response_status),
            opt_text(a.error.as_deref()),
            int(id),
        ];
        self.exec(sql, params).map(drop)
    }

    fn deliveries(&self, webhook_id: i64, limit: i64) -> Result<Vec<Delivery>> {
        let sql = "SELECT id,event,status,attempts,response_status,last_error,created_at FROM webhook_deliveries
                   WHERE webhook_id=? ORDER BY id DESC LIMIT ?";
        self.rows(sql, vec![int(webhook_id), int(limit)], PLAIN)
    }

    fn automation_rules(&self) -> Result<Vec<AutomationRule>> {
        self.rows("SELECT * FROM automation_rules ORDER BY id", vec![], RULE)
    }

    fn active_rules(&self, event_name: &str) -> Result<Vec<AutomationRule>> {
        let sql = "SELECT * FROM automation_rules WHERE active=1 AND event_name=? ORDER BY id";
        self.rows(sql, vec![text(event_name)], RULE)
    }

    fn automation_rule(&self, id: i64) -> Result<Option<AutomationRule>> {
        self.row("SELECT * FROM automation_rules WHERE id=?", vec![int(id)], RULE)
    }

    fn create_rule(&self, rule: &NewRule) -> Result<AutomationRule> {
        let id = self.insert(
            "INSERT INTO automation_rules(name,description,event_name,conditions,actions,active,created) VALUES(?,?,?,?,?,?,?)",
            vec![
                text(rule.name.as_str()),
                opt_text(rule.description.as_deref()),
                text(rule.event_name.as_str()),
                json_text(&rule.conditions)?,
                json_text(&rule.actions)?,
                flag(rule.active),
                text(iso(now_ms())),
            ],
        )?;
        self.automation_rule(id)?.ok_or_else(|| Error::internal("rule vanished"))
    }

    fn update_rule(&self, id: i64, fields: &RuleFields) -> Result<AutomationRule> {
        let mut changes: Vec<(&str, Sql)> = Vec::new();
        if let Some(name) = &fields.name {
            changes.push(("name", text(name.as_str())));
        }
        if let Some(description) = &fields.description {
            changes.push(("description", opt_text(description.as_deref())));
        }
        if let Some(event) = &fields.event_name {
            changes.push(("event_name", text(event.as_str())));
        }
        if let Some(conditions) = &fields.conditions {
            changes.push(("conditions", json_text(conditions)?));
        }
        if let Some(actions) = &fields.actions {
            changes.push(("actions", json_text(actions)?));
        }
        if let Some(active) = fields.active {
            changes.push(("active", flag(active)));
        }
        self.update_fields("automation_rules", int(id), changes)?;
        self.automation_rule(id)?.ok_or_else(|| Error::internal("rule vanished"))
    }

    fn delete_rule(&self, id: i64) -> Result<()> {
        self.exec("DELETE FROM automation_rules WHERE id=?", vec![int(id)]).map(drop)
    }
}
