//! Edge cases of business hours, CSAT and webhook rules beyond the Node suite.
mod rules_support;

use rules_support::message;
use serde_json::json;
use wamcp_server::domain::csat::{awaiting_csat, parse_rating, CSAT_SURVEY, CSAT_THANKS, CSAT_WINDOW_SECONDS};
use wamcp_server::domain::model::{Conversation, DaySchedule, Inbox, WorkingHour};
use wamcp_server::domain::schedule::{is_open, local_time, validate_schedule, validate_timezone};
use wamcp_server::domain::webhooks::*;

fn inbox(timezone: &str) -> Inbox {
    serde_json::from_value(json!({
        "id": 1, "account_id": 1, "name": "S", "channel_type": "whatsapp", "channel_id": 1,
        "enable_auto_assignment": 1, "greeting_enabled": 0, "greeting_message": null,
        "lock_to_single_conversation": 0, "allow_messages_after_resolved": 1, "timezone": timezone,
        "created": "", "agent_bot_enabled": 0, "working_hours_enabled": 1, "out_of_office_message": null,
        "csat_survey_enabled": 0, "session_id": "s", "ignore_groups": 1, "session_status": "open", "phone": null
    }))
    .expect("inbox")
}

const SUNDAY_MIDNIGHT_UTC: i64 = 1_791_072_000; // 2026-10-04T00:00:00Z

#[test]
fn business_hours_boundaries_and_timezones() {
    assert_eq!(local_time(SUNDAY_MIDNIGHT_UTC, "UTC"), (0, 0));
    assert_eq!(
        local_time(SUNDAY_MIDNIGHT_UTC, "Asia/Kolkata"),
        (0, 330),
        "half-hour offsets"
    );
    assert_eq!(
        local_time(SUNDAY_MIDNIGHT_UTC, "America/Sao_Paulo"),
        (6, 1260),
        "previous Saturday"
    );
    assert_eq!(
        local_time(SUNDAY_MIDNIGHT_UTC, "Mars/Olympus"),
        (0, 0),
        "unknown zones read as UTC"
    );
    assert_eq!(
        local_time(SUNDAY_MIDNIGHT_UTC, "america/sao_paulo"),
        (6, 1260),
        "case-insensitive"
    );
    assert_eq!(
        local_time(i64::MAX, "UTC"),
        (4, 0),
        "out of range reads as the epoch (Thursday)"
    );
    let utc = inbox("UTC");
    let sunday = |open_minutes, close_minutes| {
        [WorkingHour {
            inbox_id: 1,
            day_of_week: 0,
            closed_all_day: 0,
            open_minutes,
            close_minutes,
        }]
    };
    assert!(
        is_open(&utc, &sunday(0, 60), SUNDAY_MIDNIGHT_UTC),
        "opening minute is open"
    );
    assert!(!is_open(&utc, &sunday(1, 60), SUNDAY_MIDNIGHT_UTC));
    assert!(
        !is_open(&utc, &sunday(0, 60), SUNDAY_MIDNIGHT_UTC + 3600),
        "closing minute is closed"
    );
    assert!(is_open(&utc, &sunday(0, 60), SUNDAY_MIDNIGHT_UTC + 3599));
    assert!(
        !is_open(&inbox("America/Sao_Paulo"), &sunday(0, 1440), SUNDAY_MIDNIGHT_UTC),
        "it is Saturday there"
    );
}

#[test]
fn schedules_and_timezones_are_validated() {
    let d = |day_of_week, closed_all_day, open_minutes, close_minutes| DaySchedule {
        day_of_week,
        closed_all_day,
        open_minutes,
        close_minutes,
    };
    assert!(validate_schedule(&[]).is_ok());
    assert!(validate_schedule(&[d(0, false, 0, 1), d(6, false, 0, 1440)]).is_ok());
    let same = message(validate_schedule(&[d(1, false, 600, 600)]));
    assert_eq!(same, "O horário de abertura precisa ser antes do fechamento");
    assert_eq!(
        message(validate_schedule(&[d(1, true, 0, 0), d(1, true, 0, 0)])),
        "Dia da semana repetido"
    );
    let parsed: DaySchedule =
        serde_json::from_value(json!({ "day_of_week": 2, "open_minutes": 1, "close_minutes": 2 }))
            .expect("closed_all_day defaults to false");
    assert!(!parsed.closed_all_day);
    assert!(validate_timezone("UTC").is_ok());
    assert!(validate_timezone("America/Sao_Paulo").is_ok());
    assert!(validate_timezone("asia/tokyo").is_ok());
    assert_eq!(message(validate_timezone("")), "Fuso horário inválido");
}

fn conversation(status: &str, requested_at: Option<i64>) -> Conversation {
    serde_json::from_value(json!({
        "id": 1, "account_id": 1, "display_id": 1, "inbox_id": 1, "contact_id": 1, "contact_inbox_id": 1,
        "status": status, "priority": null, "assignee_id": null, "team_id": null, "snoozed_until": null,
        "waiting_since": null, "first_reply_at": null, "agent_last_seen_at": null, "last_activity_at": 0,
        "custom_attributes": {}, "created": "", "csat_requested_at": requested_at, "contact_name": null,
        "contact_phone": null, "contact_jid": "1@s.whatsapp.net", "inbox_name": "S",
        "agent_bot_enabled": 0, "assignee_name": null, "team_name": null, "labels": [],
        "last_message": null, "unread_count": 0
    }))
    .expect("conversation")
}

#[test]
fn csat_replies_accept_common_formats() {
    let r = |text: &str| parse_rating(text).map(|r| (r.rating, r.feedback));
    assert_eq!(r("nota5"), Some((5, None)));
    assert_eq!(r("NOTA 2: ruim"), Some((2, Some("ruim".into()))));
    assert_eq!(r("1!"), Some((1, None)));
    assert_eq!(r("4 – bom"), Some((4, Some("bom".into()))), "en dash");
    assert_eq!(r("5 muito bom"), Some((5, Some("muito bom".into()))));
    assert_eq!(
        r("5\nmuito\nbom"),
        Some((5, Some("muito\nbom".into()))),
        "feedback spans lines"
    );
    assert_eq!(r("5   "), Some((5, None)));
    assert_eq!(r("10"), Some((1, Some("0".into()))), "same as the Node regex");
    assert_eq!(r("0"), None);
    assert_eq!(r("nota"), None);
    assert_eq!(r("a 5"), None);
    assert!(CSAT_SURVEY.contains("1 (ruim) a 5 (excelente)"));
    assert_eq!(CSAT_THANKS, "Obrigado pela avaliação!");
}

#[test]
fn csat_window_needs_a_real_request_time() {
    assert!(
        !awaiting_csat(Some(&conversation("resolved", Some(0))), 10),
        "0 is falsy like in Node"
    );
    assert!(awaiting_csat(Some(&conversation("resolved", Some(1000))), 1000));
    assert!(
        awaiting_csat(Some(&conversation("resolved", Some(1000))), 900),
        "clock skew still captures"
    );
    assert!(!awaiting_csat(Some(&conversation("snoozed", Some(1000))), 1000));
    assert_eq!(CSAT_WINDOW_SECONDS, 86_400);
}

#[test]
fn webhook_events_map_every_internal_event() {
    let pairs = [
        ("conversation.created", "conversation_created"),
        ("conversation.status_changed", "conversation_status_changed"),
        ("conversation.updated", "conversation_updated"),
        ("team.changed", "conversation_updated"),
        ("message.updated", "message_updated"),
        ("contact.created", "contact_created"),
        ("contact.updated", "contact_updated"),
        ("csat.created", "csat_created"),
        ("conversation.typing_on", "conversation_typing_on"),
        ("conversation.typing_off", "conversation_typing_off"),
    ];
    for (internal, public) in pairs {
        assert_eq!(webhook_event_for(internal), Some(public), "{internal}");
        assert!(is_webhook_event(public));
    }
    assert!(
        !is_webhook_event("message.created"),
        "internal names are not subscriptions"
    );
    assert_eq!(WEBHOOK_EVENTS.len(), 10);
    assert_eq!((retry_delay(0), retry_delay(-1), retry_delay(6)), (None, None, None));
}

#[test]
fn webhook_urls_accept_plain_http_and_reject_partial_credentials() {
    let subs = vec!["message_created".to_string(), "csat_created".to_string()];
    assert!(validate_webhook("http://10.0.0.1:8080/hook?x=1", &subs).is_ok());
    assert_eq!(
        message(validate_webhook("https://u@example.com", &subs)),
        "Não inclua credenciais na URL"
    );
    assert_eq!(
        message(validate_webhook("https://:p@example.com", &subs)),
        "Não inclua credenciais na URL"
    );
    assert_eq!(
        message(validate_webhook("mailto:a@example.com", &subs)),
        "Use uma URL http(s)"
    );
    assert_eq!(message(validate_webhook("", &subs)), "URL inválida");
    let mixed = vec!["message_created".to_string(), "nope".to_string()];
    assert_eq!(
        message(validate_webhook("https://example.com", &mixed)),
        "Escolha eventos válidos"
    );
}
