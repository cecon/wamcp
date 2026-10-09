//! Rules for the browser crawl: which store links are accepted, how the human-verification page is
//! recognised (it is never solved automatically) and which network responses may hold the menu.
use crate::domain::error::{fail, Result};
use crate::domain::menu::rules::fold;

pub const WAITING_HUMAN: &str = "Confirme no navegador que você é humano";
pub const STATUSES: [&str; 8] = [
    "starting",
    "opening",
    "waiting_human",
    "loading",
    "ready",
    "applied",
    "failed",
    "cancelled",
];
/// Statuses of an import still being crawled.
pub const RUNNING: [&str; 4] = ["starting", "opening", "waiting_human", "loading"];

/// Only `https://ifood.com.br/…` or `https://www.ifood.com.br/…` store pages.
pub fn store_url(address: &str) -> Result<String> {
    let invalid = || fail("Use o link da loja no iFood (https://www.ifood.com.br/delivery/…)");
    let Ok(parsed) = url::Url::parse(address.trim()) else {
        return invalid();
    };
    let host = parsed.host_str().unwrap_or_default();
    let valid = parsed.scheme() == "https"
        && matches!(host, "ifood.com.br" | "www.ifood.com.br")
        && parsed.port().is_none()
        && parsed.username().is_empty()
        && parsed.password().is_none()
        && parsed.path().trim_matches('/').len() > 1;
    if valid {
        Ok(parsed.to_string())
    } else {
        invalid()
    }
}

/// Cloudflare / PerimeterX interstitials, by page title or by the presence of a challenge frame.
pub fn is_challenge(title: &str, challenge_frame: bool) -> bool {
    let title = fold(title);
    challenge_frame
        || [
            "um momento",
            "just a moment",
            "executando verificacao",
            "verificando",
            "attention required",
            "access denied",
            "confirme que e humano",
            "are you a human",
        ]
        .iter()
        .any(|t| title.contains(t))
}

/// Network responses worth keeping: JSON from catalog/menu/site-api endpoints.
pub fn is_menu_response(address: &str, mime: &str) -> bool {
    let address = address.to_ascii_lowercase();
    mime.to_ascii_lowercase().contains("json") && ["catalog", "menu", "site-api"].iter().any(|k| address.contains(k))
}
