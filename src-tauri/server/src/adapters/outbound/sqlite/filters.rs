//! Advanced filters: translates validated conditions into a parameterised WHERE clause.
use super::conversations::{order, SELECT, SHAPE};
use super::db::{int, placeholders, text, SqliteStore};
use super::inboxes::{CONTACT, PAGE};
use crate::domain::error::Result;
use crate::domain::filters::attribute_kind;
use crate::domain::model::{Condition, Contact, Conversation, FilterQuery};
use rusqlite::types::Value as Sql;
use serde_json::Value;

/// SQL expression for a built-in attribute (`None` for labels and custom attributes).
fn column(model: &str, key: &str) -> Option<&'static str> {
    if model == "contact" {
        return Some(match key {
            "name" => "ct.name",
            "phone_number" => "ct.phone_number",
            "email" => "ct.email",
            "identifier" => "ct.identifier",
            "created_at" => "CAST(strftime('%s', ct.created) AS INTEGER)",
            "last_activity_at" => "ct.last_activity_at",
            _ => return None,
        });
    }
    Some(match key {
        "status" => "c.status",
        "assignee_id" => "c.assignee_id",
        "inbox_id" => "c.inbox_id",
        "team_id" => "c.team_id",
        "priority" => "c.priority",
        "display_id" => "c.display_id",
        "created_at" => "CAST(strftime('%s', c.created) AS INTEGER)",
        "last_activity_at" => "c.last_activity_at",
        "contact_name" => "ct.name",
        "contact_phone" => "ct.phone_number",
        "contact_email" => "ct.email",
        _ => return None,
    })
}

/// A filter value as SQL: numbers stay numbers, dates become epoch seconds, booleans 0/1.
fn bind(value: &Value, kind: &str) -> Sql {
    match value {
        Value::Bool(b) => int(i64::from(*b)),
        Value::Number(n) => n.as_i64().map_or_else(|| Sql::Real(n.as_f64().unwrap_or(0.0)), int),
        Value::String(s) if kind == "date" => chrono::NaiveDate::parse_from_str(&s[..s.len().min(10)], "%Y-%m-%d")
            .ok()
            .and_then(|d| d.and_hms_opt(0, 0, 0))
            .map_or(Sql::Null, |d| int(d.and_utc().timestamp())),
        Value::String(s) if kind == "number" => s.trim().parse::<i64>().map_or_else(|_| text(s.as_str()), int),
        Value::String(s) => text(s.as_str()),
        other => text(other.to_string()),
    }
}

fn first_text(c: &Condition) -> String {
    match c.values.first() {
        Some(Value::String(s)) => s.clone(),
        Some(other) => other.to_string(),
        None => String::new(),
    }
}

/// The predicate for one condition, pushing its parameters.
fn predicate(model: &str, c: &Condition, query: &FilterQuery, args: &mut Vec<Sql>) -> String {
    let kind = attribute_kind(model, &c.attribute_key, &query.custom).unwrap_or("text");
    let op = c.filter_operator.as_str();
    if c.attribute_key == "labels" {
        let (table, owner, id) = if model == "contact" {
            ("contact_labels", "x.contact_id", "ct.id")
        } else {
            ("conversation_labels", "x.conversation_id", "c.id")
        };
        let exists = |cond: &str| {
            format!("EXISTS(SELECT 1 FROM {table} x JOIN labels l ON l.id=x.label_id WHERE {owner}={id}{cond})")
        };
        return match op {
            "is_present" => exists(""),
            "is_not_present" => format!("NOT {}", exists("")),
            "contains" | "does_not_contain" => {
                args.push(text(format!("%{}%", first_text(c))));
                let found = exists(" AND l.title LIKE ?");
                if op == "contains" {
                    found
                } else {
                    format!("NOT {found}")
                }
            }
            _ => {
                args.extend(c.values.iter().map(|v| bind(v, "text")));
                let found = exists(&format!(" AND l.title IN ({})", placeholders(c.values.len())));
                if op == "not_equal_to" {
                    format!("NOT {found}")
                } else {
                    found
                }
            }
        };
    }
    let expr = match column(model, &c.attribute_key) {
        Some(column) => column.to_string(),
        None => {
            // Keys are validated against the definitions; keep only [a-z0-9_] before inlining the path.
            let key: String = c
                .attribute_key
                .trim_start_matches("custom_attribute:")
                .chars()
                .filter(|ch| ch.is_ascii_alphanumeric() || *ch == '_')
                .collect();
            let table = if model == "contact" { "ct" } else { "c" };
            let raw = format!("json_extract({table}.custom_attributes, '$.{key}')");
            if kind == "date" {
                format!("CAST(strftime('%s', {raw}) AS INTEGER)")
            } else {
                raw
            }
        }
    };
    match op {
        "is_present" => format!("({expr} IS NOT NULL AND {expr} <> '')"),
        "is_not_present" => format!("({expr} IS NULL OR {expr} = '')"),
        "contains" | "does_not_contain" => {
            args.push(text(format!("%{}%", first_text(c))));
            if op == "contains" {
                format!("{expr} LIKE ?")
            } else {
                format!("({expr} IS NULL OR {expr} NOT LIKE ?)")
            }
        }
        "is_greater_than" | "is_less_than" => {
            args.push(c.values.first().map_or(Sql::Null, |v| bind(v, kind)));
            format!("{expr} {} ?", if op == "is_greater_than" { ">" } else { "<" })
        }
        "days_before" => {
            let days = c.values.first().and_then(|v| match v {
                Value::Number(n) => n.as_i64(),
                Value::String(s) => s.trim().parse().ok(),
                _ => None,
            });
            args.push(int(query.now - days.unwrap_or(0) * 86_400));
            format!("{expr} < ?")
        }
        _ => {
            args.extend(c.values.iter().map(|v| bind(v, kind)));
            let list = placeholders(c.values.len());
            if op == "not_equal_to" {
                format!("({expr} IS NULL OR {expr} NOT IN ({list}))")
            } else {
                format!("{expr} IN ({list})")
            }
        }
    }
}

/// Chatwoot semantics: each condition's `query_operator` joins it to the next one.
fn where_clause(model: &str, query: &FilterQuery, args: &mut Vec<Sql>) -> String {
    let mut sql = String::new();
    for (index, condition) in query.conditions.iter().enumerate() {
        if index > 0 {
            let joiner = &query.conditions[index - 1].query_operator;
            sql.push_str(if joiner == "or" { " OR " } else { " AND " });
        }
        sql.push_str(&predicate(model, condition, query, args));
    }
    format!("({sql})")
}

impl SqliteStore {
    pub(super) fn filtered_conversations(&self, query: &FilterQuery) -> Result<Vec<Conversation>> {
        let mut args = Vec::new();
        let mut sql = format!("{SELECT} WHERE {}", where_clause("conversation", query, &mut args));
        if let Some(ids) = &query.visible_inbox_ids {
            sql.push_str(&format!(" AND c.inbox_id IN ({})", placeholders(ids.len())));
            args.extend(ids.iter().map(|id| int(*id)));
        }
        sql.push_str(&format!(" ORDER BY {} LIMIT ? OFFSET ?", order(None)));
        args.push(int(PAGE));
        args.push(int((query.page.max(1) - 1) * PAGE));
        self.rows(&sql, args, SHAPE)
    }

    pub(super) fn filtered_contacts(&self, query: &FilterQuery) -> Result<Vec<Contact>> {
        let mut args = Vec::new();
        let sql = format!(
            "SELECT ct.* FROM contacts ct WHERE {} ORDER BY ct.last_activity_at DESC NULLS LAST, ct.id DESC LIMIT ? OFFSET ?",
            where_clause("contact", query, &mut args)
        );
        args.push(int(PAGE));
        args.push(int((query.page.max(1) - 1) * PAGE));
        self.rows(&sql, args, CONTACT)
    }
}
