//! Edge cases of automation rules beyond the Node suite (schedules, CSAT and webhooks live in
//! `domain_schedule_edges.rs`).
mod rules_support;

use rules_support::{action, cond, message};
use serde_json::{json, Value};
use wamcp_server::domain::automation::*;
use wamcp_server::domain::model::{Action, Condition};

#[test]
fn values_are_compared_as_lowercase_text() {
    assert_eq!(text_of(&Value::Null), "");
    assert_eq!(text_of(&json!("BoLeTo")), "boleto");
    assert_eq!(text_of(&json!(5)), "5");
    assert_eq!(text_of(&json!(true)), "true");
    assert_eq!(raw_text(&json!("Olá Mundo")), "Olá Mundo");
    assert_eq!(raw_text(&Value::Null), "");
    assert_eq!(raw_text(&json!(42)), "42");
}

#[test]
fn every_operator_handles_scalars_lists_and_missing_attributes() {
    let ctx = json!({ "assignee_id": 5, "inbox_id": 2, "content": "", "labels": ["vip", "n1"], "contact_name": null });
    let one = |c: Condition| matches_conditions(&[c], &ctx);
    assert!(
        one(cond("assignee_id", "equal_to", json!([5]), "and")),
        "numbers compare as text"
    );
    assert!(one(cond("assignee_id", "equal_to", json!(["5"]), "and")));
    assert!(one(cond("assignee_id", "not_equal_to", json!([6]), "and")));
    assert!(one(cond("inbox_id", "is_present", json!([]), "and")));
    assert!(
        one(cond("content", "is_not_present", json!([]), "and")),
        "empty strings are absent"
    );
    assert!(one(cond("contact_name", "is_not_present", json!([]), "and")));
    assert!(
        one(cond("team_id", "is_not_present", json!([]), "and")),
        "missing keys are absent"
    );
    assert!(!one(cond("team_id", "equal_to", json!([1]), "and")));
    assert!(one(cond("labels", "contains", json!(["N"]), "and")));
    assert!(one(cond("labels", "does_not_contain", json!(["spam"]), "and")));
    assert!(
        !one(cond("labels", "not_equal_to", json!(["x", "n1"]), "and")),
        "any wanted value matches"
    );
    assert!(one(cond("labels", "equal_to", json!(["x", "N1"]), "and")));
    assert!(
        !one(cond("labels", "equal_to", json!([]), "and")),
        "no values never equal"
    );
    assert!(one(cond("labels", "is_present", json!([]), "and")));
}

#[test]
fn chains_evaluate_left_to_right_without_precedence() {
    let ctx = json!({ "status": "open", "content": "boleto" });
    let f = |q| cond("status", "equal_to", json!(["resolved"]), q);
    let t = |q| cond("content", "contains", json!(["boleto"]), q);
    assert!(
        !matches_conditions(&[f("or"), t("and"), f("and")], &ctx),
        "(false or true) and false"
    );
    assert!(
        matches_conditions(&[f("and"), t("or"), t("and")], &ctx),
        "(false and true) or true"
    );
    assert!(
        matches_conditions(&[t("x"), t("and")], &ctx),
        "unknown joins read as and"
    );
    assert!(!matches_conditions(&[t("x"), f("and")], &ctx));
}

#[test]
fn rule_validation_reports_each_problem() {
    let ok = [action("resolve_conversation", json!([]))];
    for event in AUTOMATION_EVENTS {
        assert!(validate_rule(event, &[], &ok).is_ok(), "{event}");
    }
    let presence = [cond("assignee_id", "is_present", json!([]), "and")];
    assert!(
        validate_rule("message_created", &presence, &ok).is_ok(),
        "presence needs no value"
    );
    let msg = |c: &[Condition], a: &[Action]| message(validate_rule("message_created", c, a));
    assert_eq!(
        msg(&[cond("x", "equal_to", json!([1]), "and")], &ok),
        "Condição inválida"
    );
    assert_eq!(msg(&[cond("status", "x", json!([1]), "and")], &ok), "Operador inválido");
    assert_eq!(
        msg(&[cond("status", "contains", json!([]), "and")], &ok),
        "Informe um valor para a condição"
    );
    assert_eq!(msg(&[], &[]), "Inclua ao menos uma ação");
    assert_eq!(msg(&[], &[action("x", json!([1]))]), "Ação inválida");
    assert_eq!(
        msg(&[], &[action("assign_agent", json!([]))]),
        "Informe o parâmetro da ação"
    );
    assert_eq!(
        msg(&[], &[action("add_private_note", json!([""]))]),
        "A mensagem da automação não pode ser vazia"
    );
    assert_eq!(message(validate_rule("nope", &[], &ok)), "Evento de automação inválido");
    let fine = [
        action("set_priority", json!(["high"])),
        action("send_message", json!([5])),
        action("open_conversation", json!([])),
    ];
    assert!(validate_rule("conversation_opened", &[], &fine).is_ok());
    assert_eq!((CONDITION_ATTRIBUTES.len(), OPERATORS.len(), ACTIONS.len()), (9, 6, 9));
}

#[test]
// Deliberate difference from Node (String(null) === "null"): a null message is empty, not the text "null".
fn null_text_parameters_are_empty_messages() {
    let rule = [action("send_message", json!([null]))];
    assert!(validate_rule("message_created", &[], &rule).is_err());
}

#[test]
fn automation_events_ignore_unrelated_payloads() {
    let created = json!({ "message_type": "outgoing", "private": false });
    assert_eq!(automation_events_for("message.created", &created), ["message_created"]);
    assert_eq!(
        automation_events_for("message.created", &json!({})),
        ["message_created"]
    );
    assert!(automation_events_for("conversation.status_changed", &json!({})).is_empty());
    assert!(automation_events_for("conversation.updated", &json!({ "status": "open" })).is_empty());
}

#[test]
fn request_bodies_default_the_join_and_distinguish_null_from_absent() {
    use wamcp_server::domain::model::InboxChanges;
    let body = json!({ "attribute_key": "status", "filter_operator": "is_present" });
    let parsed: Condition = serde_json::from_value(body).expect("condition");
    assert_eq!((parsed.query_operator.as_str(), parsed.values.len()), ("and", 0));
    let cleared: InboxChanges = serde_json::from_value(json!({ "greeting_message": null })).expect("changes");
    assert_eq!(cleared.greeting_message, Some(None));
    let absent: InboxChanges = serde_json::from_value(json!({})).expect("changes");
    assert_eq!(absent.greeting_message, None);
}
