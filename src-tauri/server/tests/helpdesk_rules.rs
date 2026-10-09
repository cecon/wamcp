//! Port of tests/helpdesk-rules.test.mjs: business hours, automations, CSAT and webhooks (the
//! webhook sender lives in `webhook_sender.rs`).
mod rules_support;

use rules_support::{action, cond, message};
use serde_json::json;
use wamcp_server::domain::automation::{automation_events_for, matches_conditions, validate_rule};
use wamcp_server::domain::csat::{awaiting_csat, parse_rating, Rating, CSAT_WINDOW_SECONDS};
use wamcp_server::domain::model::{Condition, Conversation, DaySchedule, Inbox, WorkingHour};
use wamcp_server::domain::schedule::{is_open, local_time, validate_schedule, validate_timezone};
use wamcp_server::domain::webhooks::{retry_delay, validate_webhook, webhook_event_for, MAX_ATTEMPTS};

/// 2026-10-05T12:30:00Z is a Monday; in São Paulo (UTC-3) it is 09:30.
const MONDAY_NOON_UTC: i64 = 1_791_203_400;

fn inbox(enabled: i64, timezone: &str) -> Inbox {
    serde_json::from_value(json!({
        "id": 1, "account_id": 1, "name": "Suporte", "channel_type": "whatsapp", "channel_id": 1,
        "enable_auto_assignment": 1, "greeting_enabled": 0, "greeting_message": null,
        "lock_to_single_conversation": 0, "allow_messages_after_resolved": 1, "timezone": timezone,
        "created": "", "agent_bot_enabled": 0, "working_hours_enabled": enabled, "out_of_office_message": null,
        "csat_survey_enabled": 0, "session_id": "s", "ignore_groups": 1, "session_status": "open", "phone": null
    }))
    .expect("inbox")
}

fn hour(day: i64, closed: i64, open: i64, close: i64) -> WorkingHour {
    WorkingHour {
        inbox_id: 1,
        day_of_week: day,
        closed_all_day: closed,
        open_minutes: open,
        close_minutes: close,
    }
}

fn day(day: i64, closed: bool, open: i64, close: i64) -> DaySchedule {
    DaySchedule {
        day_of_week: day,
        closed_all_day: closed,
        open_minutes: open,
        close_minutes: close,
    }
}

#[test]
fn working_hours_follow_the_inbox_timezone() {
    assert_eq!(local_time(MONDAY_NOON_UTC, "UTC"), (1, 750));
    assert_eq!(local_time(MONDAY_NOON_UTC, "America/Sao_Paulo"), (1, 570));
    let sp = inbox(1, "America/Sao_Paulo");
    let monday = [hour(1, 0, 540, 1080)];
    assert!(is_open(&sp, &monday, MONDAY_NOON_UTC));
    assert!(
        !is_open(&inbox(1, "Asia/Tokyo"), &monday, MONDAY_NOON_UTC),
        "Monday 21:30 in Tokyo"
    );
    assert!(!is_open(&sp, &[hour(1, 1, 540, 1080)], MONDAY_NOON_UTC));
    assert!(!is_open(&sp, &[], MONDAY_NOON_UTC), "days without hours are closed");
    assert!(is_open(&inbox(0, "America/Sao_Paulo"), &[], MONDAY_NOON_UTC));
    let d = day(1, false, 540, 1080);
    assert!(message(validate_schedule(&[d.clone(), d.clone()])).contains("repetido"));
    assert!(message(validate_schedule(&[day(1, false, 1100, 1080)])).contains("abertura"));
    assert!(validate_schedule(&[day(1, true, 1100, 1080)]).is_ok());
    assert!(message(validate_timezone("Mars/Olympus")).contains("Fuso"));
}

#[test]
fn automation_conditions_chain_with_and_or_like_chatwoot() {
    let ctx = json!({
        "content": "Quero a segunda via do BOLETO", "labels": ["vip"], "status": "open", "assignee_id": null
    });
    let and = |a, o, v| cond(a, o, v, "and");
    assert!(matches_conditions(&[], &ctx));
    assert!(matches_conditions(
        &[and("content", "contains", json!(["boleto"]))],
        &ctx
    ));
    assert!(!matches_conditions(
        &[and("content", "does_not_contain", json!(["boleto"]))],
        &ctx
    ));
    assert!(matches_conditions(&[and("labels", "equal_to", json!(["VIP"]))], &ctx));
    assert!(!matches_conditions(
        &[and("labels", "not_equal_to", json!(["vip"]))],
        &ctx
    ));
    assert!(matches_conditions(
        &[and("assignee_id", "is_not_present", json!([]))],
        &ctx
    ));
    assert!(!matches_conditions(
        &[and("assignee_id", "is_present", json!([]))],
        &ctx
    ));
    assert!(!matches_conditions(
        &[and("status", "unknown_op", json!(["open"]))],
        &ctx
    ));
    let or_chain = [
        cond("status", "equal_to", json!(["resolved"]), "or"),
        and("content", "contains", json!(["boleto"])),
    ];
    assert!(matches_conditions(&or_chain, &ctx));
    let and_chain = [
        and("status", "equal_to", json!(["resolved"])),
        and("content", "contains", json!(["boleto"])),
    ];
    assert!(!matches_conditions(&and_chain, &ctx));
}

#[test]
fn automation_rules_are_validated_and_mapped_from_helpdesk_events() {
    let ok = [action("resolve_conversation", json!([]))];
    assert!(validate_rule("message_created", &[], &ok).is_ok());
    assert!(message(validate_rule("x", &[], &ok)).contains("Evento"));
    assert!(message(validate_rule("message_created", &[], &[])).contains("ao menos"));
    assert!(message(validate_rule("message_created", &[], &[action("explode", json!([]))])).contains("Ação"));
    let no_param = [action("add_label", json!([]))];
    assert!(message(validate_rule("message_created", &[], &no_param)).contains("parâmetro"));
    let blank = [action("send_message", json!([" "]))];
    assert!(message(validate_rule("message_created", &[], &blank)).contains("vazia"));
    let bad = |c: Condition| message(validate_rule("message_created", &[c], &ok));
    assert!(bad(cond("x", "equal_to", json!(["x"]), "and")).contains("Condição"));
    assert!(bad(cond("status", "x", json!(["x"]), "and")).contains("Operador"));
    assert!(bad(cond("status", "equal_to", json!([]), "and")).contains("valor"));

    assert_eq!(
        automation_events_for("conversation.created", &json!({})),
        ["conversation_created"]
    );
    let incoming = json!({ "message_type": "incoming" });
    assert_eq!(automation_events_for("message.created", &incoming), ["message_created"]);
    assert!(automation_events_for("message.created", &json!({ "message_type": "activity" })).is_empty());
    let note = json!({ "message_type": "outgoing", "private": true });
    assert!(automation_events_for("message.created", &note).is_empty());
    let status = |s: &str| automation_events_for("conversation.status_changed", &json!({ "status": s }));
    assert_eq!(status("resolved"), ["conversation_resolved"]);
    assert_eq!(status("open"), ["conversation_opened"]);
    assert!(status("snoozed").is_empty());
    assert!(automation_events_for("assignee.changed", &json!({})).is_empty());
}

fn resolved(requested_at: Option<i64>, status: &str) -> Conversation {
    serde_json::from_value(json!({
        "id": 1, "account_id": 1, "display_id": 1, "inbox_id": 1, "contact_id": 1, "contact_inbox_id": 1,
        "status": status, "priority": null, "assignee_id": null, "team_id": null, "snoozed_until": null,
        "waiting_since": null, "first_reply_at": null, "agent_last_seen_at": null, "last_activity_at": 0,
        "custom_attributes": {}, "created": "", "csat_requested_at": requested_at, "contact_name": null,
        "contact_phone": null, "contact_jid": "1@s.whatsapp.net", "inbox_name": "Suporte",
        "agent_bot_enabled": 0, "assignee_name": null, "team_name": null, "labels": [],
        "last_message": null, "unread_count": 0
    }))
    .expect("conversation")
}

fn rating(rating: i64, feedback: Option<&str>) -> Option<Rating> {
    Some(Rating {
        rating,
        feedback: feedback.map(String::from),
    })
}

#[test]
fn csat_answers_are_parsed_from_plain_whatsapp_replies_within_24_hours() {
    assert_eq!(parse_rating("5"), rating(5, None));
    assert_eq!(
        parse_rating("Nota 4 - atendimento rápido"),
        rating(4, Some("atendimento rápido"))
    );
    assert_eq!(parse_rating(" 3, ok "), rating(3, Some("ok")));
    assert_eq!(parse_rating("6"), None);
    assert_eq!(parse_rating("obrigado"), None);
    assert_eq!(parse_rating(""), None, "null reads as an empty reply");
    let done = resolved(Some(1000), "resolved");
    assert!(awaiting_csat(Some(&done), 1000 + CSAT_WINDOW_SECONDS));
    assert!(!awaiting_csat(Some(&done), 1001 + CSAT_WINDOW_SECONDS));
    assert!(!awaiting_csat(Some(&resolved(Some(1000), "open")), 1000));
    assert!(!awaiting_csat(Some(&resolved(None, "resolved")), 1000));
    assert!(!awaiting_csat(None, 1000));
}

#[test]
fn webhook_events_retries_and_urls_follow_the_delivery_policy() {
    assert_eq!(webhook_event_for("assignee.changed"), Some("conversation_updated"));
    assert_eq!(webhook_event_for("message.created"), Some("message_created"));
    assert_eq!(webhook_event_for("presence.update"), None);
    let delays: Vec<_> = (1..=5).map(retry_delay).collect();
    assert_eq!(delays, [Some(30), Some(120), Some(600), Some(3600), None]);
    assert_eq!(MAX_ATTEMPTS, 5);
    let subs = vec!["message_created".to_string()];
    assert!(validate_webhook("https://example.com/hook", &subs).is_ok());
    assert!(message(validate_webhook("nota url", &subs)).contains("URL inválida"));
    assert!(message(validate_webhook("ftp://example.com", &subs)).contains("http"));
    assert!(message(validate_webhook("https://u:p@example.com", &subs)).contains("credenciais"));
    assert!(message(validate_webhook("https://example.com/hook", &["nope".into()])).contains("eventos"));
    assert!(message(validate_webhook("https://example.com/hook", &[])).contains("eventos"));
}
