//! OAuth domain rules: scope mapping and the allowed redirect URIs.
use wamcp_server::domain::oauth::{oauth_require, scope_for, scopes_for, valid_oauth_redirect, OAUTH_SCOPES};

#[test]
fn oauth_scopes_map_to_session_scopes() {
    assert_eq!(OAUTH_SCOPES, ["whatsapp:read", "whatsapp:send"]);
    assert_eq!(scopes_for("read_write"), ["whatsapp:read", "whatsapp:send"]);
    assert_eq!(scopes_for("read"), ["whatsapp:read"]);
    assert_eq!(scopes_for("anything"), ["whatsapp:read"]);
    assert_eq!(
        scope_for(&["whatsapp:read".into(), "whatsapp:send".into()]),
        "read_write"
    );
    assert_eq!(scope_for(&["whatsapp:send".into()]), "read_write");
    assert_eq!(scope_for(&["whatsapp:read".into()]), "read");
    assert_eq!(scope_for(&[]), "read");
    assert!(oauth_require(true, "x", "invalid_grant").is_ok());
    let failure = oauth_require(false, "Código expirado", "invalid_grant").expect_err("failure");
    assert_eq!(
        (failure.code.as_str(), failure.message.as_str()),
        ("invalid_grant", "Código expirado")
    );
}

#[test]
fn only_chatgpt_connectors_and_the_desktop_loopback_are_valid_redirects() {
    let valid = [
        "https://chatgpt.com/connector/oauth/abc_DEF-123",
        "https://chatgpt.com/connector_platform_oauth_redirect",
        "https://ChatGPT.com/connector/oauth/x",
        "http://127.0.0.1:53682/callback",
        "http://127.0.0.1:1/callback/abc-123_X",
    ];
    for url in valid {
        assert!(valid_oauth_redirect(url), "{url}");
    }
    let invalid = [
        "not a url",
        "https://chatgpt.com/connector/oauth/",
        "https://chatgpt.com/connector/oauth/a/b",
        "https://chatgpt.com:8443/connector/oauth/x",
        "https://chatgpt.com/connector/oauth/x?state=1",
        "https://chatgpt.com/connector/oauth/x#frag",
        "https://u:p@chatgpt.com/connector/oauth/x",
        "https://u@chatgpt.com/connector/oauth/x",
        "http://chatgpt.com/connector/oauth/x",
        "https://evil.com/connector/oauth/x",
        "https://chatgpt.com.evil.com/connector/oauth/x",
        "http://127.0.0.1/callback",
        "http://127.0.0.1:80/callback",
        "https://127.0.0.1:8443/callback",
        "http://localhost:53682/callback",
        "http://127.0.0.1:53682/other",
        "http://127.0.0.1:53682/callback/",
        "http://127.0.0.1:53682/callback/a/b",
    ];
    for url in invalid {
        assert!(!valid_oauth_redirect(url), "{url}");
    }
    let long_segment = format!("http://127.0.0.1:5000/callback/{}", "a".repeat(129));
    assert!(!valid_oauth_redirect(&long_segment));
    assert!(valid_oauth_redirect(&format!(
        "http://127.0.0.1:5000/callback/{}",
        "a".repeat(128)
    )));
}
