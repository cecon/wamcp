//! Edge cases of the pure helpdesk rules, actors, access checks and domain errors.
use serde_json::json;
use wamcp_server::domain::access::{
    media_too_large, require_send_permission, require_session_credential, MAX_MEDIA_BYTES,
};
use wamcp_server::domain::actor::{Actor, Performer, BOT_NAME};
use wamcp_server::domain::error::{Error, HelpdeskError};
use wamcp_server::domain::helpdesk::*;
use wamcp_server::domain::model::{Credential, User};

fn failure<T: std::fmt::Debug>(result: Result<T, Error>) -> (u16, String) {
    match result {
        Err(Error::Helpdesk(e)) => (e.status, e.message),
        other => panic!("expected a business error, got {other:?}"),
    }
}

fn user(id: i64, role: &str, display_name: Option<&str>) -> User {
    serde_json::from_value(json!({
        "id": id, "account_id": 1, "email": "a@example.com", "name": "Ana", "display_name": display_name,
        "role": role, "availability": "online", "active": 1, "created": "", "last_login": null
    }))
    .expect("user")
}

fn strings(items: &[&str]) -> Vec<String> {
    items.iter().map(|s| s.to_string()).collect()
}

#[test]
fn constants_mirror_the_node_lists() {
    assert_eq!(ROLES, ["administrator", "agent"]);
    assert_eq!(STATUSES, ["open", "pending", "resolved", "snoozed"]);
    assert_eq!(AVAILABILITY, ["online", "busy", "offline"]);
    assert_eq!(PRIORITIES, ["low", "medium", "high", "urgent"]);
}

#[test]
fn inbox_access_is_required_for_agents_and_hidden_as_not_found() {
    let agent = Actor::User(user(2, "agent", None));
    assert!(require_inbox_access(&agent, &[3], 3).is_ok());
    assert_eq!(
        failure(require_inbox_access(&agent, &[3], 4)),
        (404, "Conversa não encontrada".into())
    );
    assert!(require_inbox_access(&Actor::system("automation", "Automação"), &[], 4).is_ok());
    assert!(require_admin(&Actor::User(user(1, "administrator", None))).is_ok());
    assert!(
        require_admin(&Actor::contact()).is_ok(),
        "system actors act as administrators"
    );
    let (status, message) = failure(require_admin(&Actor::Bot { inbox_id: 1 }));
    assert_eq!(
        (status, message.as_str()),
        (403, "Somente administradores podem fazer isso")
    );
    assert!(!can_access_inbox(&Actor::Bot { inbox_id: 1 }, &[], 1));
}

#[test]
fn support_jids_and_phones_cover_every_branch() {
    assert!(!is_support_jid("", false));
    assert!(!is_support_jid("x@broadcast", false));
    assert!(!is_support_jid("1203@newsletter", false));
    assert!(is_support_jid("anything-else", true));
    assert_eq!(phone_from_jid(Some("12345@s.whatsapp.net")), None, "too short");
    assert_eq!(
        phone_from_jid(Some("123456@s.whatsapp.net")).as_deref(),
        Some("+123456")
    );
    assert_eq!(
        phone_from_jid(Some("1234567890123456@s.whatsapp.net")),
        None,
        "too long"
    );
    assert_eq!(phone_from_jid(Some("5511999999999@g.us")), None);
    assert_eq!(phone_from_jid(Some("x5511999999999@s.whatsapp.net")), None);
    assert_eq!(phone_from_jid(Some("")), None);
}

#[test]
fn round_robin_and_initial_status_edges() {
    assert_eq!(next_assignee(&[7], Some(7)), Some(7));
    assert_eq!(next_assignee(&[7], None), Some(7));
    assert_eq!(next_assignee(&[3, 3, 1], Some(1)), Some(3));
    assert_eq!(next_assignee(&[3, 1], Some(0)), Some(1));
    assert_eq!(initial_status(true), "pending");
    assert_eq!(initial_status(false), "open");
}

#[test]
fn status_change_messages_and_snooze_boundaries() {
    assert_eq!(
        failure(validate_status_change("closed", None, 0)),
        (400, "Status inválido".into())
    );
    let past = failure(validate_status_change("snoozed", Some(100), 100));
    assert_eq!(
        past.1, "O adiamento precisa ser no futuro",
        "now itself is not the future"
    );
    assert!(
        validate_status_change("snoozed", None, 100).is_ok(),
        "snooze until next reply"
    );
    assert!(
        validate_status_change("open", Some(1), 100).is_ok(),
        "only snoozes check the date"
    );
    assert!(validate_status_change("pending", None, 100).is_ok());
}

#[test]
fn activity_messages_name_the_actor_or_the_system() {
    assert_eq!(status_activity(Some("Ana"), "open"), "Ana reabriu a conversa");
    assert_eq!(
        status_activity(None, "pending"),
        "Sistema marcou a conversa como pendente"
    );
    assert_eq!(status_activity(Some("Ana"), "resolved"), "Ana resolveu a conversa");
    assert_eq!(status_activity(Some("Ana"), "snoozed"), "Ana adiou a conversa");
    assert_eq!(assignment_activity(Some("Ana"), None), "Ana removeu o responsável");
    assert_eq!(assignment_activity(None, None), "Sistema removeu o responsável");
    assert_eq!(assignment_activity(Some("Ana"), Some("Ana")), "Ana assumiu a conversa");
    assert_eq!(
        assignment_activity(Some("Ana"), Some("Bia")),
        "Ana atribuiu a conversa a Bia"
    );
    assert_eq!(
        assignment_activity(None, Some("Bia")),
        "Sistema atribuiu a conversa a Bia"
    );
    assert_eq!(
        team_activity(Some("Ana"), Some("Vendas")),
        "Ana atribuiu a conversa ao time Vendas"
    );
    assert_eq!(team_activity(None, None), "Sistema removeu o time");
    let added = strings(&["vip", "n1"]);
    let removed = strings(&["spam"]);
    assert_eq!(labels_activity(Some("Ana"), &added, &[]), "Ana adicionou vip, n1");
    assert_eq!(labels_activity(None, &[], &removed), "Sistema removeu spam");
    assert_eq!(
        labels_activity(Some("Ana"), &added, &removed),
        "Ana adicionou vip, n1; Ana removeu spam"
    );
    assert_eq!(labels_activity(Some("Ana"), &[], &[]), "");
}

#[test]
fn passwords_count_characters_not_bytes() {
    let message = "A senha precisa ter entre 10 e 200 caracteres";
    assert_eq!(failure(validate_password("123456789")).1, message);
    assert!(validate_password("1234567890").is_ok());
    assert!(validate_password(&"x".repeat(200)).is_ok());
    assert_eq!(failure(validate_password(&"x".repeat(201))).1, message);
    assert!(validate_password(&"é".repeat(10)).is_ok());
    assert_eq!(failure(validate_password(&"é".repeat(201))).1, message);
}

#[test]
fn labels_become_lowercase_slugs() {
    assert_eq!(
        normalize_label_title("  Suporte   N1 ").ok().as_deref(),
        Some("suporte-n1")
    );
    assert_eq!(normalize_label_title("VIP").ok().as_deref(), Some("vip"));
    assert_eq!(normalize_label_title("Ação_2").ok().as_deref(), Some("ação_2"));
    assert_eq!(normalize_label_title(&"a".repeat(40)).ok(), Some("a".repeat(40)));
    for bad in ["", "   ", "a/b", "#vip", &"a".repeat(41)] {
        assert_eq!(
            failure(normalize_label_title(bad)),
            (400, "Etiqueta inválida".into()),
            "{bad}"
        );
    }
}

#[test]
fn canned_codes_are_trimmed_lowercase_slugs_without_spaces() {
    assert_eq!(validate_canned_code("  Oi ").ok().as_deref(), Some("oi"));
    assert_eq!(
        validate_canned_code("Boas-Vindas_1").ok().as_deref(),
        Some("boas-vindas_1")
    );
    for bad in ["", "oi tudo", "/oi", &"a".repeat(41)] {
        assert_eq!(
            failure(validate_canned_code(bad)),
            (400, "Atalho inválido".into()),
            "{bad}"
        );
    }
}

#[test]
fn actors_expose_roles_names_and_performers() {
    let ana = Actor::User(user(4, "agent", Some("Aninha")));
    assert_eq!(ana.role(), "agent");
    assert!(!ana.is_admin() && ana.is_agent());
    assert_eq!(ana.user_id(), Some(4));
    assert_eq!(ana.name().as_deref(), Some("Aninha"));
    assert_eq!(
        ana.performer(),
        Performer {
            kind: "user".into(),
            id: Some(4)
        }
    );
    assert_eq!(ana.sender_type(), "user");
    let blank = Actor::User(user(5, "administrator", Some("")));
    assert_eq!(
        blank.name().as_deref(),
        Some("Ana"),
        "empty display names fall back to the name"
    );
    assert!(blank.is_admin());

    let bot = Actor::Bot { inbox_id: 9 };
    assert_eq!((bot.role(), bot.is_agent(), bot.user_id()), ("agent_bot", false, None));
    assert_eq!(bot.name().as_deref(), Some(BOT_NAME));
    assert_eq!(
        bot.performer(),
        Performer {
            kind: "agent_bot".into(),
            id: Some(9)
        }
    );
    assert_eq!(bot.sender_type(), "agent_bot");

    let contact = Actor::contact();
    assert_eq!(contact, Actor::system("contact", "Contato"));
    assert_eq!(
        (contact.role(), contact.is_agent(), contact.user_id()),
        ("administrator", false, None)
    );
    assert_eq!(contact.name().as_deref(), Some("Contato"));
    assert!(contact.performer().is("contact"));
    assert_eq!(contact.sender_type(), "system");
    assert_eq!(
        Performer::system(),
        Performer {
            kind: "system".into(),
            id: None
        }
    );
    let serialized = serde_json::to_value(bot.performer()).expect("json");
    assert_eq!(serialized, json!({ "type": "agent_bot", "id": 9 }));
    assert!(user(1, "agent", None).is_active());
}

fn credential(session_id: &str, scope: &str) -> Credential {
    Credential {
        id: "t".into(),
        session_id: session_id.into(),
        scope: scope.into(),
        client_id: None,
    }
}

#[test]
fn credentials_are_bound_to_their_session_and_scope() {
    assert!(credential("A", "read_write").can_send());
    assert!(!credential("A", "read").can_send());
    assert!(require_send_permission(&credential("A", "read_write"), "A").is_ok());
    let denied = (403, "Credencial sem permissão de envio nesta sessão".to_string());
    assert_eq!(failure(require_send_permission(&credential("A", "read"), "A")), denied);
    assert_eq!(
        failure(require_send_permission(&credential("A", "read_write"), "B")),
        denied
    );
    assert!(require_session_credential(&credential("A", "read"), "A").is_ok());
    let other = failure(require_session_credential(&credential("A", "read"), "B"));
    assert_eq!(other, (403, "Sessão não autorizada".into()));
    assert!(!media_too_large(None));
    assert!(!media_too_large(Some(MAX_MEDIA_BYTES as i64)));
    assert!(media_too_large(Some(MAX_MEDIA_BYTES as i64 + 1)));
}

#[test]
fn domain_errors_carry_statuses_and_hide_internal_details() {
    assert_eq!(HelpdeskError::new("x").status, 400);
    assert_eq!(HelpdeskError::not_found("x").status, 404);
    assert_eq!(
        HelpdeskError::with_status("x", 409),
        HelpdeskError {
            status: 409,
            message: "x".into()
        }
    );
    let shown: Error = HelpdeskError::new("Visível").into();
    assert_eq!(shown.to_string(), "Visível");
    assert_eq!(Error::internal("disk").to_string(), "internal: disk");
    let parse = serde_json::from_str::<serde_json::Value>("{").expect_err("invalid json");
    assert!(matches!(Error::from(parse), Error::Internal(_)));
}
