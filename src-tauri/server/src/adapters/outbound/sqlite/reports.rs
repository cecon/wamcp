//! Reports v2 queries: each metric is a source (table, timestamp, value) filtered by the scope and
//! aggregated per time bucket.
use super::db::{int, text, SqliteStore, PLAIN};
use crate::application::ports::{Period, ReportScope, ReportsRepo};
use crate::domain::error::{fail, Result};
use rusqlite::types::Value as Sql;
use serde_json::{json, Value};

/// Where a metric's rows come from: FROM clause, timestamp, aggregate and agent column.
struct Source {
    from: &'static str,
    ts: &'static str,
    aggregate: &'static str,
    agent: &'static str,
}

const CONVERSATIONS: &str = "conversations c";
const MESSAGES: &str = "conversation_messages m JOIN conversations c ON c.id=m.conversation_id";
const EVENTS: &str = "reporting_events e JOIN conversations c ON c.id=e.conversation_id";

fn source(metric: &str) -> Result<(Source, &'static str)> {
    let created = "CAST(strftime('%s', c.created) AS INTEGER)";
    let (from, ts, aggregate, agent, filter) = match metric {
        "conversations_count" => (CONVERSATIONS, created, "COUNT(*)", "c.assignee_id", "1=1"),
        "incoming_messages_count" => (
            MESSAGES,
            "m.created_at",
            "COUNT(*)",
            "c.assignee_id",
            "m.message_type='incoming'",
        ),
        "outgoing_messages_count" => (
            MESSAGES,
            "m.created_at",
            "COUNT(*)",
            "(CASE WHEN m.sender_type='user' THEN m.sender_id END)",
            "m.message_type='outgoing' AND m.private=0",
        ),
        "resolutions_count" => (
            EVENTS,
            "e.created_at",
            "COUNT(*)",
            "e.user_id",
            "e.name='conversation_resolved'",
        ),
        "avg_resolution_time" => (
            EVENTS,
            "e.created_at",
            "AVG(e.value)",
            "e.user_id",
            "e.name='conversation_resolved'",
        ),
        "avg_first_response_time" => (
            EVENTS,
            "e.created_at",
            "AVG(e.value)",
            "e.user_id",
            "e.name='first_response'",
        ),
        _ => return fail("Métrica inválida"),
    };
    Ok((
        Source {
            from,
            ts,
            aggregate,
            agent,
        },
        filter,
    ))
}

fn bucket(ts: &str, group_by: &str) -> String {
    match group_by {
        "week" => format!("((({ts}) - 345600) / 604800) * 604800 + 345600"),
        "month" => format!("CAST(strftime('%s', {ts}, 'unixepoch', 'start of month') AS INTEGER)"),
        "day" => format!("(({ts}) / 86400) * 86400"),
        _ => "0".into(),
    }
}

/// The scope's WHERE fragment and parameters.
fn scope_filter(source: &Source, scope: &ReportScope) -> (String, Vec<Sql>) {
    let mut args = vec![int(scope.since), int(scope.until)];
    let ts = source.ts;
    let mut sql = format!("{ts}>=? AND {ts}<?");
    let column = match scope.dimension.as_str() {
        "inbox" => Some("c.inbox_id"),
        "agent" => Some(source.agent),
        "team" => Some("c.team_id"),
        _ => None,
    };
    if let (Some(column), Some(id)) = (column, scope.id) {
        sql.push_str(&format!(" AND {column}=?"));
        args.push(int(id));
    }
    if let (true, Some(label)) = (scope.dimension == "label", &scope.label) {
        sql.push_str(" AND EXISTS(SELECT 1 FROM conversation_labels cl JOIN labels l ON l.id=cl.label_id WHERE cl.conversation_id=c.id AND l.title=?)");
        args.push(text(label.as_str()));
    }
    (sql, args)
}

fn period_args(p: &Period) -> (String, Vec<Sql>) {
    let mut args = vec![int(p.since), int(p.until)];
    let inbox = p.inbox_id.map_or(String::new(), |id| {
        args.push(int(id));
        " AND inbox_id=?".into()
    });
    (inbox, args)
}

impl ReportsRepo for SqliteStore {
    fn metric_series(&self, metric: &str, scope: &ReportScope, group_by: &str) -> Result<Vec<(i64, f64)>> {
        let (source, filter) = source(metric)?;
        let (where_scope, args) = scope_filter(&source, scope);
        let sql = format!(
            "SELECT {} AS bucket, {} AS value FROM {} WHERE {filter} AND {where_scope} GROUP BY bucket ORDER BY bucket",
            bucket(source.ts, group_by),
            source.aggregate,
            source.from
        );
        self.with(|c| {
            let mut statement = c.prepare_cached(&sql)?;
            let rows = statement.query_map(rusqlite::params_from_iter(args), |r| {
                Ok((r.get::<_, i64>(0)?, r.get::<_, Option<f64>>(1)?.unwrap_or(0.0)))
            })?;
            rows.collect()
        })
    }

    fn csat_metrics(&self, p: &Period) -> Result<Value> {
        let (inbox, args) = period_args(p);
        let sql = format!(
            "SELECT rating, COUNT(*) AS count FROM csat_responses WHERE created_at>=? AND created_at<?{inbox} GROUP BY rating"
        );
        let rows: Vec<Value> = self.rows(&sql, args.clone(), PLAIN)?;
        let mut ratings = json!({ "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 });
        for row in &rows {
            ratings[row["rating"].to_string()] = row["count"].clone();
        }
        let sent_sql = format!(
            "SELECT COUNT(*) FROM reporting_events WHERE name='csat_sent' AND created_at>=? AND created_at<?{inbox}"
        );
        let sent = self.scalar(&sent_sql, args)?.unwrap_or(0);
        Ok(json!({ "ratings": ratings, "sent": sent }))
    }

    fn bot_metrics(&self, p: &Period) -> Result<Value> {
        let (inbox, args) = period_args(p);
        let inbox = inbox.replace("inbox_id", "c.inbox_id");
        let bot =
            "EXISTS(SELECT 1 FROM conversation_messages m WHERE m.conversation_id=c.id AND m.sender_type='agent_bot')";
        let human = "EXISTS(SELECT 1 FROM conversation_messages m WHERE m.conversation_id=c.id AND m.sender_type='user' AND m.message_type='outgoing')";
        let created = "CAST(strftime('%s', c.created) AS INTEGER)";
        let sql = format!(
            "SELECT COUNT(*) AS conversations,
               SUM(CASE WHEN c.status='resolved' AND NOT {human} THEN 1 ELSE 0 END) AS resolutions,
               SUM(CASE WHEN {human} THEN 1 ELSE 0 END) AS handoffs
             FROM conversations c WHERE {bot} AND {created}>=? AND {created}<?{inbox}"
        );
        let row: Value = self.row(&sql, args, PLAIN)?.unwrap_or_default();
        let number = |key: &str| row[key].as_i64().unwrap_or(0);
        Ok(json!({
            "conversations": number("conversations"),
            "resolutions": number("resolutions"),
            "handoffs": number("handoffs"),
        }))
    }
}
