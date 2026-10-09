use super::db::{int, text, SqliteStore};
use crate::application::ports::{EventRepo, OAuthRepo, QueueItem, Subscription, Transactional};
use crate::domain::error::{Error, Result};
use rusqlite::types::Value as Sql;
use serde_json::Value;

const MAX_SUBSCRIPTIONS: i64 = 1000;
const MAX_OWNER_SUBSCRIPTIONS: i64 = 50;
const MAX_QUEUE: i64 = 10_000;
const MAX_SUBSCRIPTION_QUEUE: i64 = 1000;
const MAX_RECEIPTS: i64 = 50_000;

impl SqliteStore {
    fn values(&self, sql: &str, params: Vec<Sql>) -> Result<Vec<String>> {
        self.with(|c| {
            let mut statement = c.prepare_cached(sql)?;
            let rows = statement.query_map(rusqlite::params_from_iter(params), |r| r.get(0))?;
            rows.collect()
        })
    }

    fn total(&self, table: &str) -> Result<i64> {
        Ok(self
            .scalar(&format!("SELECT COUNT(*) FROM {table}"), vec![])?
            .unwrap_or(0))
    }
}

impl Transactional for SqliteStore {
    fn transaction_dyn(&self, work: &mut dyn FnMut() -> Result<()>) -> Result<()> {
        self.transaction(work)
    }
}

impl OAuthRepo for SqliteStore {
    fn get(&self, bucket: &str, key: &str, now: i64) -> Result<Option<Value>> {
        let sql = "SELECT value FROM oauth_items WHERE bucket=? AND key=? AND expires>?";
        let found = self.values(sql, vec![text(bucket), text(key), int(now)])?;
        found
            .first()
            .map(|v| serde_json::from_str(v).map_err(Error::from))
            .transpose()
    }

    fn set(&self, bucket: &str, key: &str, value: &Value, expires: i64) -> Result<()> {
        let sql = "INSERT INTO oauth_items VALUES(?,?,?,?) ON CONFLICT(bucket,key) DO UPDATE SET value=excluded.value,expires=excluded.expires";
        self.exec(
            sql,
            vec![text(bucket), text(key), text(value.to_string()), int(expires)],
        )
        .map(drop)
    }

    fn remove(&self, bucket: &str, key: &str) -> Result<()> {
        self.exec(
            "DELETE FROM oauth_items WHERE bucket=? AND key=?",
            vec![text(bucket), text(key)],
        )
        .map(drop)
    }

    fn list(&self, bucket: &str, now: i64) -> Result<Vec<Value>> {
        let found = self.values(
            "SELECT value FROM oauth_items WHERE bucket=? AND expires>?",
            vec![text(bucket), int(now)],
        )?;
        found
            .iter()
            .map(|v| serde_json::from_str(v).map_err(Error::from))
            .collect()
    }

    fn prune(&self, now: i64) -> Result<()> {
        self.exec("DELETE FROM oauth_items WHERE expires<=?", vec![int(now)])
            .map(drop)
    }
}

impl EventRepo for SqliteStore {
    fn subscription(&self, id: &str) -> Result<Option<Subscription>> {
        let found = self.values("SELECT value FROM event_subscriptions WHERE id=?", vec![text(id)])?;
        found
            .first()
            .map(|v| serde_json::from_str(v).map_err(Error::from))
            .transpose()
    }

    fn subscriptions(&self, session_id: Option<&str>) -> Result<Vec<Subscription>> {
        let found = match session_id {
            None => self.values("SELECT value FROM event_subscriptions", vec![])?,
            Some(id) => self.values(
                "SELECT value FROM event_subscriptions WHERE session_id=?",
                vec![text(id)],
            )?,
        };
        found
            .iter()
            .map(|v| serde_json::from_str(v).map_err(Error::from))
            .collect()
    }

    fn save_subscription(&self, s: &Subscription) -> Result<()> {
        if self.subscription(&s.id)?.is_none() {
            let sql =
                "SELECT COUNT(*) FROM event_subscriptions WHERE session_id=? AND principal_id=? AND principal_kind=?";
            let owned = self
                .scalar(
                    sql,
                    vec![
                        text(s.session_id.as_str()),
                        text(s.principal_id.as_str()),
                        text(s.principal_kind.as_str()),
                    ],
                )?
                .unwrap_or(0);
            if self.total("event_subscriptions")? >= MAX_SUBSCRIPTIONS || owned >= MAX_OWNER_SUBSCRIPTIONS {
                return Err(
                    crate::domain::error::HelpdeskError::new("Limite de assinaturas de eventos atingido").into(),
                );
            }
        }
        let value = serde_json::to_string(s)?;
        self.transaction(&mut || {
            let sql = "INSERT INTO event_subscriptions VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET expires=excluded.expires,value=excluded.value";
            let params = vec![
                text(s.id.as_str()),
                text(s.session_id.as_str()),
                text(s.principal_id.as_str()),
                text(s.principal_kind.as_str()),
                int(s.expires),
                text(value.as_str()),
            ];
            self.exec(sql, params)?;
            self.exec("UPDATE event_queue SET expires=? WHERE subscription_id=?", vec![int(s.expires), text(s.id.as_str())])?;
            Ok(())
        })
    }

    fn remove_subscription(&self, id: &str) -> Result<()> {
        self.exec("DELETE FROM event_subscriptions WHERE id=?", vec![text(id)])
            .map(drop)
    }

    fn remove_session_subscriptions(&self, session_id: &str) -> Result<()> {
        self.exec(
            "DELETE FROM event_subscriptions WHERE session_id=?",
            vec![text(session_id)],
        )
        .map(drop)
    }

    fn prune_events(&self, now: i64) -> Result<()> {
        self.exec("DELETE FROM event_subscriptions WHERE expires<=?", vec![int(now)])?;
        self.exec("DELETE FROM event_queue WHERE expires<=?", vec![int(now)])?;
        self.exec("DELETE FROM event_receipts WHERE expires<=?", vec![int(now)])?;
        self.exec("DELETE FROM event_attempts WHERE at<=?", vec![int(now - 86_400_000)])?;
        for mut subscription in self.subscriptions(None)? {
            if subscription.previous_secret.is_some() && subscription.rotate_until.is_some_and(|u| u <= now) {
                subscription.previous_secret = None;
                subscription.rotate_until = None;
                self.save_subscription(&subscription)?;
            }
        }
        Ok(())
    }

    fn enqueue(&self, s: &Subscription, event: &Value, now: i64) -> Result<bool> {
        if self.subscription(&s.id)?.is_none() {
            return Ok(false);
        }
        let event_id = event["eventId"].as_str().unwrap_or_default().to_string();
        let item = QueueItem {
            subscription_id: s.id.clone(),
            event_id: event_id.clone(),
            event: event.clone(),
            attempts: -1,
        };
        let seen = self.scalar(
            "SELECT 1 FROM event_receipts WHERE subscription_id=? AND event_id=?",
            vec![text(s.id.as_str()), text(event_id.as_str())],
        )?;
        if seen.is_some() || self.has_pending(&item)? {
            return Ok(false);
        }
        let pending = self
            .scalar(
                "SELECT COUNT(*) FROM event_queue WHERE subscription_id=?",
                vec![text(s.id.as_str())],
            )?
            .unwrap_or(0);
        if pending >= MAX_SUBSCRIPTION_QUEUE || self.total("event_queue")? >= MAX_QUEUE {
            self.record(&item, 0, "queue_full", now)?;
            return Ok(false);
        }
        self.transaction(&mut || {
            let sql = "INSERT INTO event_queue(subscription_id,event_id,event,next_attempt,expires) VALUES(?,?,?,?,?)";
            self.exec(sql, vec![text(s.id.as_str()), text(event_id.as_str()), text(event.to_string()), int(now), int(s.expires)])?;
            let sql = "INSERT INTO event_receipts VALUES(?,?,?)";
            self.exec(sql, vec![text(s.id.as_str()), text(event_id.as_str()), int(now + 86_400_000)])?;
            let extra = self.total("event_receipts")? - MAX_RECEIPTS;
            if extra > 0 {
                let sql = "DELETE FROM event_receipts WHERE rowid IN (SELECT rowid FROM event_receipts ORDER BY expires LIMIT ?)";
                self.exec(sql, vec![int(extra)])?;
            }
            Ok(())
        })?;
        Ok(true)
    }

    fn due(&self, now: i64, limit: i64) -> Result<Vec<QueueItem>> {
        let sql = "SELECT subscription_id,event_id,event,attempts FROM (SELECT *,ROW_NUMBER() OVER(PARTITION BY subscription_id ORDER BY next_attempt,event_id) AS position
                   FROM event_queue WHERE next_attempt<=? AND expires>?) WHERE position=1 ORDER BY next_attempt,event_id LIMIT ?";
        let rows = self.with(|c| {
            let mut statement = c.prepare_cached(sql)?;
            let rows = statement.query_map([now, now, limit], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, i64>(3)?,
                ))
            })?;
            rows.collect::<rusqlite::Result<Vec<_>>>()
        })?;
        rows.into_iter()
            .map(|(subscription_id, event_id, event, attempts)| {
                Ok(QueueItem {
                    subscription_id,
                    event_id,
                    event: serde_json::from_str(&event)?,
                    attempts,
                })
            })
            .collect()
    }

    fn has_pending(&self, item: &QueueItem) -> Result<bool> {
        let sql = "SELECT 1 FROM event_queue WHERE subscription_id=? AND event_id=?";
        Ok(self
            .scalar(
                sql,
                vec![text(item.subscription_id.as_str()), text(item.event_id.as_str())],
            )?
            .is_some())
    }

    fn retry(&self, item: &QueueItem, next_attempt: i64) -> Result<()> {
        let sql = "UPDATE event_queue SET attempts=attempts+1,next_attempt=? WHERE subscription_id=? AND event_id=?";
        self.exec(
            sql,
            vec![
                int(next_attempt),
                text(item.subscription_id.as_str()),
                text(item.event_id.as_str()),
            ],
        )
        .map(drop)
    }

    fn finish(&self, item: &QueueItem) -> Result<()> {
        let sql = "DELETE FROM event_queue WHERE subscription_id=? AND event_id=?";
        self.exec(
            sql,
            vec![text(item.subscription_id.as_str()), text(item.event_id.as_str())],
        )
        .map(drop)
    }

    fn record(&self, item: &QueueItem, status: i64, outcome: &str, now: i64) -> Result<()> {
        let Some(subscription) = self.subscription(&item.subscription_id)? else {
            return Ok(());
        };
        let status = if (0..=599).contains(&status) { status } else { 0 };
        let sql = "INSERT INTO event_attempts(session_id,subscription_id,event_id,attempt,status,outcome,at) VALUES(?,?,?,?,?,?,?)";
        let params = vec![
            text(subscription.session_id.as_str()),
            text(subscription.id.as_str()),
            text(item.event_id.as_str()),
            int(item.attempts + 1),
            int(status),
            text(outcome),
            int(now),
        ];
        self.exec(sql, params)?;
        self.exec(
            "DELETE FROM event_attempts WHERE id NOT IN (SELECT id FROM event_attempts ORDER BY id DESC LIMIT 1000)",
            vec![],
        )
        .map(drop)
    }
}
