//! Audit entries for API requests and TOTP vectors.
use wamcp_server::domain::audit::audit_entry;
use wamcp_server::domain::totp::{base32_decode, base32_encode, code_at, verify};

fn describe(method: &str, path: &str) -> Option<String> {
    audit_entry(method, path).map(|e| format!("{} {} {:?}", e.action, e.auditable_type, e.auditable_id))
}

#[test]
fn audited_requests_map_to_actions() {
    let cases = [
        ("POST", "/agents", Some("create user None")),
        ("PATCH", "/agents/5", Some("update user Some(5)")),
        ("DELETE", "/agents/5/mfa", Some("remove_mfa user Some(5)")),
        (
            "POST",
            "/automation_rules/3/clone",
            Some("clone automation_rule Some(3)"),
        ),
        ("POST", "/actions/contact_merge", Some("merge contact None")),
        ("POST", "/contacts/import", Some("import contact None")),
        ("DELETE", "/contacts/2", Some("delete contact Some(2)")),
        ("POST", "/profile/mfa/verify", Some("verify profile None")),
        ("DELETE", "/profile/sessions", Some("remove_sessions profile None")),
        ("POST", "/macros/1/execute", None),
        ("POST", "/contacts", None),
        ("PATCH", "/contacts/2", None),
        ("POST", "/conversations/1/messages", None),
        ("PATCH", "/profile", None),
        ("POST", "/notifications/read_all", None),
        ("GET", "/agents/1/mfa", None),
        ("POST", "/", None),
    ];
    for (method, path, expected) in cases {
        assert_eq!(describe(method, path).as_deref(), expected, "{method} {path}");
    }
}

#[test]
fn totp_matches_the_rfc_6238_vectors() {
    let secret = b"12345678901234567890";
    assert_eq!(base32_encode(secret), "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    assert_eq!(
        base32_decode("gezd gnbv gy3t qojq gezd gnbv gy3t qojq").unwrap(),
        secret
    );
    assert_eq!(base32_decode("1"), None);
    assert_eq!(base32_encode(b"f"), "MY");
    // RFC 6238 SHA-1 vectors (8 digits there; the last 6 here).
    assert_eq!(code_at(secret, 59 / 30), "287082");
    assert_eq!(code_at(secret, 1_111_111_109 / 30), "081804");
    assert_eq!(verify(secret, "287 082", 59, None), Some(1));
    assert_eq!(verify(secret, "287082", 59 + 30, None), Some(1), "one step of drift");
    assert_eq!(verify(secret, "287082", 59, Some(1)), None, "replay");
    assert_eq!(verify(secret, "28708", 59, None), None);
    assert_eq!(verify(secret, "abcdef", 59, None), None);
}
