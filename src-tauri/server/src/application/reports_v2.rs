//! Reports v2: time series per metric, summaries compared with the previous period, breakdowns per
//! inbox/agent/team/label, CSAT metrics and export, and AI assistant (bot) metrics.
use super::ports::{Period, ReportScope};
use super::reports::ReportService;
use crate::domain::actor::Actor;
use crate::domain::contacts::csv_field;
use crate::domain::error::{fail, Result};
use crate::domain::helpdesk::require_admin;
use crate::domain::reports::{buckets, percent, METRICS};
use serde_json::{json, Map, Value};

const DAY: i64 = 86_400;

/// A report request; the period defaults to the last 7 days.
#[derive(Debug, Clone, Default)]
pub struct ReportQuery {
    pub metric: Option<String>,
    pub dimension: String,
    pub id: Option<i64>,
    pub label: Option<String>,
    pub since: Option<i64>,
    pub until: Option<i64>,
    pub group_by: String,
}

impl ReportService {
    fn scope(&self, q: &ReportQuery) -> Result<ReportScope> {
        let until = q.until.unwrap_or(self.core.now() + 1);
        let since = q.since.unwrap_or(until - 7 * DAY);
        if since >= until || until - since > 366 * DAY {
            return fail("Período inválido (até 1 ano)");
        }
        if q.dimension != "account" && q.id.is_none() && q.label.is_none() {
            return fail("Informe o item do relatório");
        }
        Ok(ReportScope {
            since,
            until,
            dimension: q.dimension.clone(),
            id: q.id,
            label: q.label.clone(),
        })
    }

    fn total(&self, metric: &str, scope: &ReportScope) -> Result<f64> {
        let series = self.core.repo.metric_series(metric, scope, "all")?;
        Ok(series.first().map_or(0.0, |(_, v)| (v * 10.0).round() / 10.0))
    }

    /// One point per bucket (zero when nothing happened), like Chatwoot's charts.
    pub fn timeseries(&self, actor: &Actor, q: &ReportQuery) -> Result<Vec<Value>> {
        require_admin(actor)?;
        let scope = self.scope(q)?;
        let metric = q.metric.as_deref().unwrap_or_default();
        let found = self.core.repo.metric_series(metric, &scope, &q.group_by)?;
        Ok(buckets(scope.since, scope.until, &q.group_by)
            .into_iter()
            .map(|start| {
                let value = found.iter().find(|(b, _)| *b == start).map_or(0.0, |(_, v)| *v);
                json!({ "timestamp": start, "value": (value * 10.0).round() / 10.0 })
            })
            .collect())
    }

    /// Every metric for the period and for the period of the same length just before it.
    pub fn summary_v2(&self, actor: &Actor, q: &ReportQuery) -> Result<Value> {
        require_admin(actor)?;
        let current = self.scope(q)?;
        let length = current.until - current.since;
        let previous = ReportScope {
            since: current.since - length,
            until: current.since,
            ..current.clone()
        };
        let mut result = Map::new();
        for metric in METRICS {
            let value = json!({ "current": self.total(metric, &current)?, "previous": self.total(metric, &previous)? });
            result.insert(metric.to_string(), value);
        }
        Ok(Value::Object(result))
    }

    /// Metrics for each inbox, agent, team or label.
    pub fn breakdown(&self, actor: &Actor, kind: &str, q: &ReportQuery) -> Result<Vec<Value>> {
        require_admin(actor)?;
        let repo = &self.core.repo;
        let items: Vec<(Option<i64>, String)> = match kind {
            "inbox" => repo.inboxes(None)?.into_iter().map(|i| (Some(i.id), i.name)).collect(),
            "agent" => repo.users()?.into_iter().map(|u| (Some(u.id), u.name)).collect(),
            "team" => repo.teams()?.into_iter().map(|t| (Some(t.id), t.name)).collect(),
            "label" => repo.labels()?.into_iter().map(|l| (None, l.title)).collect(),
            _ => return fail("Tipo de relatório inválido"),
        };
        let mut rows = Vec::new();
        for (id, name) in items {
            let scope = self.scope(&ReportQuery {
                dimension: kind.into(),
                label: id.is_none().then(|| name.clone()),
                id,
                ..q.clone()
            })?;
            let mut row = json!({ "id": id, "name": name });
            for metric in METRICS {
                row[metric] = json!(self.total(metric, &scope)?);
            }
            rows.push(row);
        }
        Ok(rows)
    }

    fn v2_period(&self, q: &ReportQuery) -> Result<Period> {
        let scope = self.scope(&ReportQuery {
            dimension: "account".into(),
            ..q.clone()
        })?;
        let inbox_id = (q.dimension == "inbox").then_some(q.id).flatten();
        Ok(Period {
            since: scope.since,
            until: scope.until,
            inbox_id,
        })
    }

    /// Ratings distribution, average, response rate and satisfaction score (share of 4–5 ratings).
    pub fn csat_metrics(&self, actor: &Actor, q: &ReportQuery) -> Result<Value> {
        require_admin(actor)?;
        let raw = self.core.repo.csat_metrics(&self.v2_period(q)?)?;
        let count = |r: &str| raw["ratings"][r].as_i64().unwrap_or(0);
        let total: i64 = (1..=5).map(|r| count(&r.to_string())).sum();
        let weighted: i64 = (1..=5).map(|r| r * count(&r.to_string())).sum();
        let satisfied = count("4") + count("5");
        let sent = raw["sent"].as_i64().unwrap_or(0);
        Ok(json!({
            "total": total,
            "sent": sent,
            "ratings": raw["ratings"],
            "average": (total > 0).then(|| (weighted as f64 * 10.0 / total as f64).round() / 10.0),
            "satisfaction_score": percent(satisfied, total),
            "response_rate": percent(total, sent),
        }))
    }

    pub fn csat_csv(&self, actor: &Actor, q: &ReportQuery) -> Result<String> {
        require_admin(actor)?;
        let mut out = String::from("conversa,contato,agente,nota,comentario,data\n");
        for entry in self.core.repo.csat_responses(&self.v2_period(q)?, 10_000)? {
            let date = chrono::DateTime::from_timestamp(entry.response.created_at, 0).unwrap_or_default();
            let fields = [
                entry.display_id.to_string(),
                entry.contact_name.unwrap_or_default(),
                entry.assignee_name.unwrap_or_default(),
                entry.response.rating.to_string(),
                entry.response.feedback.unwrap_or_default(),
                date.format("%Y-%m-%d %H:%M").to_string(),
            ];
            out.push_str(&fields.iter().map(|f| csv_field(f)).collect::<Vec<_>>().join(","));
            out.push('\n');
        }
        Ok(out)
    }

    /// Conversations the AI assistant answered, resolved alone or handed off to an agent.
    pub fn bot_summary(&self, actor: &Actor, q: &ReportQuery) -> Result<Value> {
        require_admin(actor)?;
        let mut metrics = self.core.repo.bot_metrics(&self.v2_period(q)?)?;
        let total = metrics["conversations"].as_i64().unwrap_or(0);
        let rate = |key: &str| json!(percent(metrics[key].as_i64().unwrap_or(0), total));
        let (resolution, handoff) = (rate("resolutions"), rate("handoffs"));
        metrics["resolution_rate"] = resolution;
        metrics["handoff_rate"] = handoff;
        Ok(metrics)
    }
}
