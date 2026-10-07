//! Desktop admin API guard: the admin token, desktop-only origins and their CORS headers.
mod common;

use common::http::{request, send, Reply};
use common::{Fixture, ADMIN_TOKEN};

async fn raw(f: &Fixture, method: &str, path: &str, headers: &[(&str, &str)]) -> Reply {
    send(&f.app.admin_router(), request(method, path, None, headers)).await
}

#[tokio::test]
async fn admin_listener_requires_the_admin_token() {
    let f = Fixture::new().await;
    assert_eq!(raw(&f, "GET", "/api/status", &[]).await.status, 401);
    assert_eq!(
        raw(&f, "GET", "/api/status", &[("authorization", "Bearer wrong")])
            .await
            .status,
        401
    );
    let short = format!("Bearer {}", &ADMIN_TOKEN[..63]);
    assert_eq!(
        raw(&f, "GET", "/api/status", &[("authorization", &short)]).await.status,
        401
    );
    let basic = format!("Basic {ADMIN_TOKEN}");
    assert_eq!(
        raw(&f, "GET", "/api/status", &[("authorization", &basic)]).await.status,
        401
    );
    let lower = format!("bearer {ADMIN_TOKEN}");
    assert_eq!(
        raw(&f, "GET", "/api/status", &[("authorization", &lower)]).await.status,
        200
    );
    assert_eq!(raw(&f, "GET", "/api/unknown", &[]).await.status, 401);
    let missing = f.admin("GET", "/api/unknown", None).await;
    assert_eq!(missing.status, 404);
    assert_eq!(missing.header("x-content-type-options").as_deref(), Some("nosniff"));
}

#[tokio::test]
async fn admin_listener_only_answers_desktop_origins_with_cors_headers() {
    let f = Fixture::new().await;
    let auth = format!("Bearer {ADMIN_TOKEN}");
    let foreign = raw(
        &f,
        "GET",
        "/api/status",
        &[("authorization", &auth), ("origin", "https://evil.example")],
    )
    .await;
    assert_eq!(foreign.status, 403);
    assert_eq!(foreign.header("access-control-allow-origin"), None);
    let preflight_foreign = raw(&f, "OPTIONS", "/api/status", &[("origin", "https://evil.example")]).await;
    assert_eq!(preflight_foreign.status, 403);

    let local = ["http://127.0.0.1:1420", "http://localhost:1420"];
    let tauri = ["http://tauri.localhost", "https://tauri.localhost", "tauri://localhost"];
    for origin in local.into_iter().chain(tauri) {
        let reply = raw(
            &f,
            "GET",
            "/api/status",
            &[("authorization", &auth), ("origin", origin)],
        )
        .await;
        assert_eq!(reply.status, 200, "{origin}");
        assert_eq!(reply.header("access-control-allow-origin").as_deref(), Some(origin));
        assert_eq!(reply.header("vary").as_deref(), Some("Origin"));
        assert_eq!(
            reply.header("access-control-allow-headers").as_deref(),
            Some("Authorization,Content-Type")
        );
        assert_eq!(
            reply.header("access-control-allow-methods").as_deref(),
            Some("GET,POST,DELETE,OPTIONS")
        );
    }
    let preflight = raw(&f, "OPTIONS", "/api/sessions", &[("origin", "tauri://localhost")]).await;
    assert_eq!(preflight.status, 204);
    assert_eq!(
        preflight.header("access-control-allow-origin").as_deref(),
        Some("tauri://localhost")
    );
    let unauthorized = raw(&f, "GET", "/api/status", &[("origin", "http://localhost:1420")]).await;
    assert_eq!(unauthorized.status, 401);
    assert_eq!(
        unauthorized.header("access-control-allow-origin").as_deref(),
        Some("http://localhost:1420")
    );
    let plain = raw(&f, "GET", "/api/status", &[("authorization", &auth)]).await;
    assert_eq!(plain.header("access-control-allow-origin"), None);
}
