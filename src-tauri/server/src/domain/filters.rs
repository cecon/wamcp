//! Advanced filters (Chatwoot's filter builder) for conversations and contacts, and custom
//! attribute definitions with typed values.
use super::error::{fail, Result};
use super::model::Condition;
use regex::Regex;
use serde_json::Value;

/// Built-in conversation attributes and their value kind.
pub const CONVERSATION_ATTRIBUTES: [(&str, &str); 12] = [
    ("status", "text"),
    ("assignee_id", "number"),
    ("inbox_id", "number"),
    ("team_id", "number"),
    ("labels", "list"),
    ("priority", "text"),
    ("display_id", "number"),
    ("created_at", "date"),
    ("last_activity_at", "date"),
    ("contact_name", "text"),
    ("contact_phone", "text"),
    ("contact_email", "text"),
];

pub const CONTACT_ATTRIBUTES: [(&str, &str); 7] = [
    ("name", "text"),
    ("phone_number", "text"),
    ("email", "text"),
    ("identifier", "text"),
    ("labels", "list"),
    ("created_at", "date"),
    ("last_activity_at", "date"),
];

pub const FILTER_OPERATORS: [&str; 9] = [
    "equal_to",
    "not_equal_to",
    "contains",
    "does_not_contain",
    "is_present",
    "is_not_present",
    "is_greater_than",
    "is_less_than",
    "days_before",
];

pub const ATTRIBUTE_MODELS: [&str; 2] = ["conversation", "contact"];
pub const DISPLAY_TYPES: [&str; 8] = [
    "text", "number", "currency", "percent", "link", "date", "list", "checkbox",
];

/// The kind of a filter attribute: built-in, or `custom_attribute:<key>` of a definition.
pub fn attribute_kind<'a>(model: &str, key: &str, custom: &'a [(String, String)]) -> Option<&'a str> {
    let builtin = if model == "contact" {
        &CONTACT_ATTRIBUTES[..]
    } else {
        &CONVERSATION_ATTRIBUTES[..]
    };
    if let Some((_, kind)) = builtin.iter().find(|(name, _)| *name == key) {
        return Some(kind);
    }
    let custom_key = key.strip_prefix("custom_attribute:")?;
    custom
        .iter()
        .find(|(k, _)| k == custom_key)
        .map(|(_, kind)| match kind.as_str() {
            "number" | "currency" | "percent" => "number",
            "date" => "date",
            "checkbox" => "boolean",
            _ => "text",
        })
}

/// Validates a filter: known attributes and operators, and values where the operator needs one.
pub fn validate_filter(model: &str, conditions: &[Condition], custom: &[(String, String)]) -> Result<()> {
    if conditions.is_empty() || conditions.len() > 20 {
        return fail("Adicione de 1 a 20 condições");
    }
    for c in conditions {
        let Some(kind) = attribute_kind(model, &c.attribute_key, custom) else {
            return fail("Atributo de filtro inválido");
        };
        if !FILTER_OPERATORS.contains(&c.filter_operator.as_str()) {
            return fail("Operador de filtro inválido");
        }
        let numeric_only = matches!(
            c.filter_operator.as_str(),
            "is_greater_than" | "is_less_than" | "days_before"
        );
        if numeric_only && !matches!(kind, "number" | "date") {
            return fail("Operador disponível apenas para números e datas");
        }
        let needs_value = !matches!(c.filter_operator.as_str(), "is_present" | "is_not_present");
        if needs_value && c.values.is_empty() {
            return fail("Informe um valor para a condição");
        }
        if c.query_operator != "and" && c.query_operator != "or" {
            return fail("Use \"and\" ou \"or\" entre as condições");
        }
    }
    Ok(())
}

/// Normalises a custom attribute key (`plano_contratado`).
pub fn attribute_key(display_name: &str, key: Option<&str>) -> Result<String> {
    let base = key.unwrap_or(display_name).trim().to_lowercase();
    let key: String = base
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '_' })
        .collect::<String>()
        .trim_matches('_')
        .to_string();
    if key.is_empty() || key.len() > 60 {
        return fail("Chave do atributo inválida");
    }
    Ok(key)
}

/// Checks a value against its definition (`Null` clears it).
pub fn validate_value(display_type: &str, options: &[String], pattern: Option<&str>, value: &Value) -> Result<()> {
    if value.is_null() {
        return Ok(());
    }
    let ok = match display_type {
        "number" | "currency" | "percent" => value.is_number(),
        "checkbox" => value.is_boolean(),
        "date" => value
            .as_str()
            .is_some_and(|d| chrono::NaiveDate::parse_from_str(&d[..d.len().min(10)], "%Y-%m-%d").is_ok()),
        "link" => value
            .as_str()
            .is_some_and(|l| url::Url::parse(l).is_ok_and(|u| u.scheme() == "https" || u.scheme() == "http")),
        "list" => value.as_str().is_some_and(|v| options.iter().any(|o| o == v)),
        _ => value.as_str().is_some_and(|s| s.chars().count() <= 1000),
    };
    if !ok {
        return fail("Valor inválido para o atributo");
    }
    if let (Some(pattern), Some(text)) = (pattern.filter(|p| !p.is_empty()), value.as_str()) {
        let matches = Regex::new(pattern).is_ok_and(|r| r.is_match(text));
        if !matches {
            return fail("O valor não segue o formato exigido");
        }
    }
    Ok(())
}
