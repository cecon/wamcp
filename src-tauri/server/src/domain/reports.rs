//! Reports v2 (Chatwoot's reports API): metrics, dimensions and time buckets.
use chrono::{DateTime, Datelike, Months, NaiveDate};

pub const METRICS: [&str; 6] = [
    "conversations_count",
    "incoming_messages_count",
    "outgoing_messages_count",
    "resolutions_count",
    "avg_first_response_time",
    "avg_resolution_time",
];
/// `account` or one inbox, agent, team or label.
pub const DIMENSIONS: [&str; 5] = ["account", "inbox", "agent", "team", "label"];
pub const GROUPS: [&str; 3] = ["day", "week", "month"];
const DAY: i64 = 86_400;
/// 1970-01-05, the first Monday after the epoch.
const FIRST_MONDAY: i64 = 4 * DAY;

/// The start (UTC) of the bucket containing `ts`.
pub fn bucket_start(ts: i64, group_by: &str) -> i64 {
    match group_by {
        "week" => (ts - FIRST_MONDAY).div_euclid(7 * DAY) * 7 * DAY + FIRST_MONDAY,
        "month" => DateTime::from_timestamp(ts, 0)
            .and_then(|d| NaiveDate::from_ymd_opt(d.year(), d.month(), 1))
            .and_then(|d| d.and_hms_opt(0, 0, 0))
            .map_or(ts, |d| d.and_utc().timestamp()),
        _ => ts.div_euclid(DAY) * DAY,
    }
}

fn next_bucket(start: i64, group_by: &str) -> i64 {
    match group_by {
        "week" => start + 7 * DAY,
        "month" => DateTime::from_timestamp(start, 0)
            .and_then(|d| d.checked_add_months(Months::new(1)))
            .map_or(start + 31 * DAY, |d| d.timestamp()),
        _ => start + DAY,
    }
}

/// Every bucket start covering `[since, until)`, so empty periods still appear as zero.
pub fn buckets(since: i64, until: i64, group_by: &str) -> Vec<i64> {
    let mut starts = Vec::new();
    let mut current = bucket_start(since, group_by);
    while current < until && starts.len() < 1000 {
        starts.push(current);
        current = next_bucket(current, group_by);
    }
    starts
}

/// Percentage with one decimal (`None` when there is nothing to divide by).
pub fn percent(part: i64, total: i64) -> Option<f64> {
    (total > 0).then(|| (part as f64 * 1000.0 / total as f64).round() / 10.0)
}
