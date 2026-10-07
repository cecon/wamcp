//! Automation rules (subset of Chatwoot's): events, condition matching and validation.
use super::error::{fail, Result};
use super::model::{Action, Condition};
use serde_json::Value;

pub const AUTOMATION_EVENTS: [&str; 4] = [
    "conversation_created",
    "conversation_opened",
    "conversation_resolved",
    "message_created",
];
pub const CONDITION_ATTRIBUTES: [&str; 9] = [
    "content",
    "message_type",
    "status",
    "inbox_id",
    "assignee_id",
    "team_id",
    "labels",
    "contact_phone",
    "contact_name",
];
pub const OPERATORS: [&str; 6] = [
    "equal_to",
    "not_equal_to",
    "contains",
    "does_not_contain",
    "is_present",
    "is_not_present",
];
pub const ACTIONS: [&str; 9] = [
    "assign_agent",
    "assign_team",
    "add_label",
    "remove_label",
    "send_message",
    "add_private_note",
    "resolve_conversation",
    "open_conversation",
    "set_priority",
];
const TEXT_ACTIONS: [&str; 2] = ["send_message", "add_private_note"];
const NO_PARAM_ACTIONS: [&str; 2] = ["resolve_conversation", "open_conversation"];
const PRESENCE: [&str; 2] = ["is_present", "is_not_present"];

/// Lowercased text form of a scalar JSON value (`null` reads as empty, like JS `String(v ?? '')`).
pub fn text_of(value: &Value) -> String {
    match value {
        Value::Null => String::new(),
        Value::String(s) => s.to_lowercase(),
        other => other.to_string().to_lowercase(),
    }
}

/// The value of one condition attribute: a list (labels), a scalar, or absent.
fn as_list(actual: &Value) -> Vec<String> {
    match actual {
        Value::Array(items) => items.iter().map(text_of).collect(),
        Value::Null => Vec::new(),
        Value::String(s) if s.is_empty() => Vec::new(),
        other => vec![text_of(other)],
    }
}

fn test(condition: &Condition, actual: &Value) -> bool {
    let list = as_list(actual);
    let wanted: Vec<String> = condition.values.iter().map(text_of).collect();
    let present = list.iter().any(|v| !v.is_empty());
    let equals = wanted.iter().any(|w| list.contains(w));
    let contains = wanted.iter().any(|w| list.iter().any(|v| v.contains(w.as_str())));
    match condition.filter_operator.as_str() {
        "is_present" => present,
        "is_not_present" => !present,
        "equal_to" => equals,
        "not_equal_to" => !equals,
        "contains" => contains,
        "does_not_contain" => !contains,
        _ => false,
    }
}

/// Evaluates conditions left to right; each condition's `query_operator` joins it to the next one,
/// exactly like Chatwoot's automation filters. No conditions means the rule always matches.
pub fn matches_conditions(conditions: &[Condition], context: &Value) -> bool {
    let Some(first) = conditions.first() else {
        return true;
    };
    let value_of = |c: &Condition| context.get(&c.attribute_key).unwrap_or(&Value::Null).clone();
    let mut result = test(first, &value_of(first));
    for pair in conditions.windows(2) {
        let value = test(&pair[1], &value_of(&pair[1]));
        result = if pair[0].query_operator == "or" {
            result || value
        } else {
            result && value
        };
    }
    result
}

pub fn validate_rule(event_name: &str, conditions: &[Condition], actions: &[Action]) -> Result<()> {
    if !AUTOMATION_EVENTS.contains(&event_name) {
        return fail("Evento de automação inválido");
    }
    for c in conditions {
        if !CONDITION_ATTRIBUTES.contains(&c.attribute_key.as_str()) {
            return fail("Condição inválida");
        }
        if !OPERATORS.contains(&c.filter_operator.as_str()) {
            return fail("Operador inválido");
        }
        if !PRESENCE.contains(&c.filter_operator.as_str()) && c.values.is_empty() {
            return fail("Informe um valor para a condição");
        }
    }
    if actions.is_empty() {
        return fail("Inclua ao menos uma ação");
    }
    for a in actions {
        let name = a.action_name.as_str();
        if !ACTIONS.contains(&name) {
            return fail("Ação inválida");
        }
        if !NO_PARAM_ACTIONS.contains(&name) && a.action_params.is_empty() {
            return fail("Informe o parâmetro da ação");
        }
        if TEXT_ACTIONS.contains(&name) && raw_text(&a.action_params[0]).trim().is_empty() {
            return fail("A mensagem da automação não pode ser vazia");
        }
    }
    Ok(())
}

/// Text form of a parameter without changing its case.
pub fn raw_text(value: &Value) -> String {
    match value {
        Value::String(s) => s.clone(),
        Value::Null => String::new(),
        other => other.to_string(),
    }
}

/// Maps helpdesk events to the automation event names they can trigger.
pub fn automation_events_for(event: &str, data: &Value) -> Vec<&'static str> {
    match event {
        "conversation.created" => vec!["conversation_created"],
        "message.created" if data["message_type"] != "activity" && !data["private"].as_bool().unwrap_or(false) => {
            vec!["message_created"]
        }
        "conversation.status_changed" => match data["status"].as_str() {
            Some("resolved") => vec!["conversation_resolved"],
            Some("open") => vec!["conversation_opened"],
            _ => vec![],
        },
        _ => vec![],
    }
}
