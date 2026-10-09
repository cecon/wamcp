//! The agent web app on the public listener: redirects to /app/, the page with its security and
//! cache headers, immutable assets without path traversal, and a 503 when the UI was not built.
mod common;

use common::http::{request, Reply};
use common::Fixture;
use std::path::Path;

const HTML: &str = "<!doctype html><title>Agent</title>";
const SCRIPT: &str = "console.log('agent');";
const CSP: &str = "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; \
script-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";

fn built(dir: &Path) {
    std::fs::write(dir.join("agent.html"), HTML).expect("page");
    std::fs::create_dir_all(dir.join("assets")).expect("assets");
    std::fs::write(dir.join("assets").join("app.js"), SCRIPT).expect("script");
    std::fs::write(dir.join("secret.txt"), "outside assets").expect("secret");
}

async fn get(f: &Fixture, path: &str) -> Reply {
    f.public(request("GET", path, None, &[])).await
}

fn assert_secured(reply: &Reply) {
    assert_eq!(reply.header("content-security-policy").as_deref(), Some(CSP));
    assert_eq!(reply.header("x-content-type-options").as_deref(), Some("nosniff"));
    assert_eq!(reply.header("referrer-policy").as_deref(), Some("no-referrer"));
}

#[tokio::test]
async fn root_agent_html_and_bare_app_redirect_to_the_app() {
    let web = tempfile::tempdir().expect("web");
    built(web.path());
    let f = Fixture::with_web(web.path()).await;
    for path in ["/", "/agent.html", "/app"] {
        let reply = get(&f, path).await;
        assert!((300..400).contains(&reply.status), "{path}: {}", reply.status);
        assert_eq!(reply.header("location").as_deref(), Some("/app/"), "{path}");
    }
}

#[tokio::test]
async fn app_serves_the_agent_page_with_security_and_no_cache_headers() {
    let web = tempfile::tempdir().expect("web");
    built(web.path());
    let f = Fixture::with_web(web.path()).await;
    let page = get(&f, "/app/").await;
    assert_eq!(page.status, 200);
    assert_eq!(page.text, HTML);
    assert!(page.header("content-type").unwrap_or_default().starts_with("text/html"));
    assert_eq!(page.header("cache-control").as_deref(), Some("no-cache"));
    assert_secured(&page);
}

#[tokio::test]
async fn assets_are_served_with_long_cache_and_traversal_is_rejected() {
    let web = tempfile::tempdir().expect("web");
    built(web.path());
    let f = Fixture::with_web(web.path()).await;
    let script = get(&f, "/app/assets/app.js").await;
    assert_eq!(script.status, 200);
    assert_eq!(script.text, SCRIPT);
    assert!(script.header("content-type").unwrap_or_default().contains("javascript"));
    let cache = script.header("cache-control").unwrap_or_default();
    assert!(
        cache.contains("max-age=31536000") && cache.contains("immutable"),
        "{cache}"
    );
    assert_secured(&script);
    assert_eq!(get(&f, "/app/assets/missing.js").await.status, 404);
    for path in [
        "/app/assets/../secret.txt",
        "/app/assets/%2e%2e/secret.txt",
        "/app/assets/..%2fsecret.txt",
    ] {
        let reply = get(&f, path).await;
        assert!(reply.status == 404 || reply.status == 400, "{path}: {}", reply.status);
        assert!(!reply.text.contains("outside assets"), "{path}");
    }
}

#[tokio::test]
async fn the_page_is_resolved_per_request_and_missing_ui_answers_503() {
    let f = Fixture::new().await;
    let page = get(&f, "/app/").await;
    assert_eq!(page.status, 503);
    assert_eq!(page.text, "Interface web não foi gerada. Execute npm run build.");
    assert!(page
        .header("content-type")
        .unwrap_or_default()
        .starts_with("text/plain"));
    assert_secured(&page);
    assert_eq!(get(&f, "/app/assets/app.js").await.status, 404);

    let web = tempfile::tempdir().expect("web");
    let f = Fixture::with_web(web.path()).await;
    assert_eq!(get(&f, "/app/").await.status, 404, "agent.html not written yet");
    built(web.path());
    assert_eq!(get(&f, "/app/").await.text, HTML);
}
