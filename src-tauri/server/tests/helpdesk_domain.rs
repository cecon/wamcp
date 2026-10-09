//! Port of tests/helpdesk-domain.test.mjs: routing, round robin, JIDs, inbox access and status rules.
use serde_json::{json, Value};
use wamcp_server::domain::actor::Actor;
use wamcp_server::domain::error::Error;
use wamcp_server::domain::helpdesk::{
    can_access_inbox, is_support_jid, next_assignee, phone_from_jid, require_admin, route_incoming, route_own_message,
    validate_status_change, Route,
};
use wamcp_server::domain::model::{Conversation, Inbox, User};

fn conversation(status: &str) -> Conversation {
    serde_json::from_value(json!({
        "id": 1, "account_id": 1, "display_id": 1, "inbox_id": 1, "contact_id": 1, "contact_inbox_id": 1,
        "status": status, "priority": null, "assignee_id": null, "team_id": null, "snoozed_until": null,
        "waiting_since": null, "first_reply_at": null, "agent_last_seen_at": null, "last_activity_at": 0,
        "custom_attributes": "{}", "created": "", "csat_requested_at": null, "contact_name": null,
        "contact_phone": null, "contact_jid": "1@s.whatsapp.net", "inbox_name": "Suporte",
        "agent_bot_enabled": 0, "assignee_name": null, "team_name": null, "labels": [],
        "last_message": null, "unread_count": 0
    }))
    .expect("conversation")
}

fn inbox(lock: i64) -> Inbox {
    serde_json::from_value(json!({
        "id": 1, "account_id": 1, "name": "Suporte", "channel_type": "whatsapp", "channel_id": 1,
        "enable_auto_assignment": 1, "greeting_enabled": 0, "greeting_message": null,
        "lock_to_single_conversation": lock, "allow_messages_after_resolved": 1, "timezone": "UTC",
        "created": "", "agent_bot_enabled": 0, "working_hours_enabled": 0, "out_of_office_message": null,
        "csat_survey_enabled": 0, "session_id": "s", "ignore_groups": 1, "session_status": "open", "phone": null
    }))
    .expect("inbox")
}

fn user(role: &str) -> Actor {
    let value: Value = json!({
        "id": 1, "account_id": 1, "email": "a@example.com", "name": "Ana", "display_name": null,
        "role": role, "availability": "online", "active": 1, "created": "", "last_login": null
    });
    Actor::User(serde_json::from_value::<User>(value).expect("user"))
}

#[test]
fn incoming_messages_reuse_open_conversations_and_wake_snoozed_ones() {
    assert_eq!(route_incoming(None, &inbox(0)), Route::Create);
    assert_eq!(
        route_incoming(Some(&conversation("open")), &inbox(0)),
        Route::Reuse { reopen: false }
    );
    assert_eq!(
        route_incoming(Some(&conversation("pending")), &inbox(0)),
        Route::Reuse { reopen: false }
    );
    assert_eq!(
        route_incoming(Some(&conversation("snoozed")), &inbox(0)),
        Route::Reuse { reopen: true }
    );
}

#[test]
fn resolved_conversations_reopen_only_when_the_inbox_locks_contacts_to_one_conversation() {
    let resolved = conversation("resolved");
    assert_eq!(
        route_incoming(Some(&resolved), &inbox(1)),
        Route::Reuse { reopen: true }
    );
    assert_eq!(route_incoming(Some(&resolved), &inbox(0)), Route::Create);
}

#[test]
fn messages_typed_on_the_phone_never_open_new_conversations() {
    assert_eq!(route_own_message(None), Route::Ignore);
    assert_eq!(route_own_message(Some(&conversation("resolved"))), Route::Ignore);
    assert!(matches!(
        route_own_message(Some(&conversation("open"))),
        Route::Reuse { .. }
    ));
}

#[test]
fn round_robin_continues_after_the_last_assignee_and_wraps_around() {
    assert_eq!(next_assignee(&[], Some(3)), None);
    assert_eq!(next_assignee(&[5, 2, 9], None), Some(2));
    assert_eq!(next_assignee(&[5, 2, 9], Some(2)), Some(5));
    assert_eq!(next_assignee(&[5, 2, 9], Some(9)), Some(2));
    assert_eq!(next_assignee(&[5, 2, 9], Some(4)), Some(5));
}

#[test]
fn groups_broadcasts_and_channels_are_not_support_conversations() {
    assert!(is_support_jid("5511999999999@s.whatsapp.net", true));
    assert!(is_support_jid("123456@lid", true));
    assert!(!is_support_jid("120363@g.us", true));
    assert!(is_support_jid("120363@g.us", false));
    assert!(!is_support_jid("status@broadcast", false));
    assert!(!is_support_jid("1203@newsletter", true));
}

#[test]
fn phone_numbers_are_derived_only_from_phone_number_jids() {
    assert_eq!(
        phone_from_jid(Some("5511999999999@s.whatsapp.net")).as_deref(),
        Some("+5511999999999")
    );
    assert_eq!(
        phone_from_jid(Some("5511999999999:12@s.whatsapp.net")).as_deref(),
        Some("+5511999999999")
    );
    assert_eq!(phone_from_jid(Some("123456@lid")), None);
    assert_eq!(phone_from_jid(None), None);
}

#[test]
fn agents_only_reach_their_inboxes_administrators_reach_all() {
    assert!(can_access_inbox(&user("administrator"), &[], 7));
    assert!(can_access_inbox(&user("agent"), &[1, 2], 2));
    assert!(!can_access_inbox(&user("agent"), &[1, 2], 7));
    match require_admin(&user("agent")) {
        Err(Error::Helpdesk(e)) => assert_eq!(e.status, 403),
        other => panic!("expected 403, got {other:?}"),
    }
}

#[test]
fn status_changes_are_validated() {
    assert!(validate_status_change("closed", None, 100).is_err());
    assert!(validate_status_change("snoozed", Some(50), 100).is_err());
    assert!(validate_status_change("snoozed", Some(150), 100).is_ok());
    assert!(validate_status_change("resolved", None, 100).is_ok());
}
