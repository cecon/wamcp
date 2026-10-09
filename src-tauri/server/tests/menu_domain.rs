//! Catalog domain rules: shifts across midnight, money formatting, validation, photos, crawl rules,
//! search and the audit of catalog writes.
use wamcp_server::domain::audit::audit_entry;
use wamcp_server::domain::error::Error;
use wamcp_server::domain::menu::availability::{available_now, minutes, open_now, shift_covers};
use wamcp_server::domain::menu::images::{check_image, image_allowed, image_kind, image_path, image_source};
use wamcp_server::domain::menu::import::web::{is_challenge, is_menu_response, store_url};
use wamcp_server::domain::menu::money::{brl, ceil_div, cents};

use wamcp_server::domain::menu::Shift;

fn shift(days: &[i64], start: &str, end: &str) -> Shift {
    Shift {
        days: days.to_vec(),
        start: start.into(),
        end: end.into(),
    }
}

fn message<T: std::fmt::Debug>(result: Result<T, Error>) -> (u16, String) {
    match result {
        Err(Error::Helpdesk(e)) => (e.status, e.message),
        other => panic!("expected a business error, got {other:?}"),
    }
}

#[test]
fn shifts_cover_their_days_cross_midnight_and_whole_days() {
    assert_eq!(minutes("00:00"), Some(0));
    assert_eq!(minutes("23:59"), Some(1439));
    for bad in ["24:00", "9:00", "12:60", "ab:cd", "1200"] {
        assert_eq!(minutes(bad), None, "{bad}");
    }
    let dinner = shift(&[5, 6], "18:00", "02:00");
    assert!(shift_covers(&dinner, 5, 18 * 60));
    assert!(!shift_covers(&dinner, 5, 17 * 60 + 59));
    assert!(shift_covers(&dinner, 6, 60), "after midnight of Friday's shift");
    assert!(shift_covers(&dinner, 0, 60), "after midnight of Saturday's shift");
    assert!(!shift_covers(&dinner, 1, 60));
    assert!(!shift_covers(&dinner, 6, 2 * 60), "end is exclusive");
    let lunch = shift(&[1], "11:00", "15:00");
    assert!(shift_covers(&lunch, 1, 11 * 60) && !shift_covers(&lunch, 1, 15 * 60));
    assert!(shift_covers(&shift(&[3], "00:00", "00:00"), 3, 1000));
    assert!(!shift_covers(&shift(&[3], "x", "00:00"), 3, 1000));
}

#[test]
fn availability_uses_status_category_and_the_store_timezone() {
    // 2027-01-15 12:00 UTC is a Friday, 09:00 in São Paulo and 21:00 in Tokyo.
    let now = 1_800_014_400;
    let morning = [shift(&[5], "08:00", "10:00")];
    assert!(open_now(&[], now, "America/Sao_Paulo"));
    assert!(open_now(&morning, now, "America/Sao_Paulo"));
    assert!(!open_now(&morning, now, "Asia/Tokyo"));
    assert!(available_now(
        "available",
        "available",
        &morning,
        now,
        "America/Sao_Paulo"
    ));
    assert!(!available_now("unavailable", "available", &[], now, "UTC"));
    assert!(!available_now("available", "unavailable", &[], now, "UTC"));
}

#[test]
fn money_is_formatted_in_reais_and_converted_to_cents() {
    assert_eq!(brl(2990), "R$ 29,90");
    assert_eq!(brl(5), "R$ 0,05");
    assert_eq!(brl(123_450), "R$ 1.234,50");
    assert_eq!(brl(100_000_000), "R$ 1.000.000,00");
    assert_eq!(brl(-150), "-R$ 1,50");
    assert_eq!(cents(29.9), 2990);
    assert_eq!(cents(58.9), 5890);
    assert_eq!(cents(-3.0), 0);
    assert_eq!(cents(f64::NAN), 0);
    assert_eq!(ceil_div(9891, 2), 4946);
    assert_eq!(ceil_div(10, 0), 10);
}

#[test]
fn photos_are_checked_by_content_and_stored_under_catalog() {
    assert_eq!(image_kind(b"\x89PNG\r\n\x1a\nrest"), Some(("image/png", "png")));
    assert_eq!(image_kind(&[0xFF, 0xD8, 0xFF, 0xE0]), Some(("image/jpeg", "jpg")));
    assert_eq!(image_kind(b"RIFF\0\0\0\0WEBPVP8 "), Some(("image/webp", "webp")));
    assert_eq!(image_kind(b"GIF89a"), None);
    assert_eq!(message(check_image(b"")).1, "A imagem está vazia");
    assert_eq!(message(check_image(b"<svg/>")).1, "Envie uma imagem PNG, JPG ou WebP");
    let mut big = vec![0xFF, 0xD8, 0xFF];
    big.resize(5 * 1024 * 1024 + 1, 0);
    assert_eq!(message(check_image(&big)).1, "A imagem deve ter até 5 MB");
    assert_eq!(image_path("p1-abc.jpg").as_deref(), Some("catalog/p1-abc.jpg"));
    for bad in ["", "../x.jpg", ".hidden", "a/b.jpg", "a\\b.jpg"] {
        assert_eq!(image_path(bad), None, "{bad}");
    }
    assert_eq!(
        image_source("202401/x.jpg").as_deref(),
        Some("https://static-images.ifood.com.br/image/upload/t_high/pratos/202401/x.jpg")
    );
    assert_eq!(
        image_source("pratos/y.png").as_deref(),
        Some("https://static-images.ifood.com.br/image/upload/t_high/pratos/y.png")
    );
    assert_eq!(
        image_source("https://cdn.example.com/a.jpg").as_deref(),
        Some("https://cdn.example.com/a.jpg")
    );
    assert_eq!(image_source("  "), None);
    for blocked in [
        "http://cdn.example.com/a.jpg",
        "https://127.0.0.1/a.jpg",
        "https://localhost/a.jpg",
        "https://x.localhost/a",
        "nonsense",
    ] {
        assert!(!image_allowed(blocked), "{blocked}");
    }
}

#[test]
fn only_ifood_store_links_are_crawled_and_challenges_are_recognised() {
    let store = "https://www.ifood.com.br/delivery/sao-paulo-sp/burger-joint/1234-abcd";
    assert_eq!(store_url(store).unwrap(), store);
    assert!(store_url("https://ifood.com.br/delivery/x/y/z").is_ok());
    for bad in [
        "http://www.ifood.com.br/delivery/x",
        "https://www.ifood.com.br/",
        "https://evil.com/www.ifood.com.br/x",
        "https://www.ifood.com.br.evil.com/delivery/x",
        "https://user@www.ifood.com.br/delivery/x",
        "https://www.ifood.com.br:8443/delivery/x",
        "não é link",
    ] {
        assert_eq!(message(store_url(bad)).0, 400, "{bad}");
    }
    for title in [
        "Um momento…",
        "Just a moment...",
        "Executando verificação de segurança",
        "Attention Required!",
    ] {
        assert!(is_challenge(title, false), "{title}");
    }
    assert!(is_challenge("Burger Joint - iFood", true));
    assert!(!is_challenge("Burger Joint - Delivery | iFood", false));
    assert!(is_menu_response(
        "https://marketplace.ifood.com.br/v1/merchants/1/catalog",
        "application/json"
    ));
    assert!(is_menu_response(
        "https://www.ifood.com.br/api/site-api/x",
        "application/json; charset=utf-8"
    ));
    assert!(!is_menu_response(
        "https://www.ifood.com.br/menu.js",
        "application/javascript"
    ));
    assert!(!is_menu_response(
        "https://www.ifood.com.br/api/user",
        "application/json"
    ));
}

#[test]
fn catalog_writes_are_audited_but_not_reads_quotes_or_photos() {
    let describe =
        |m: &str, p: &str| audit_entry(m, p).map(|e| format!("{} {} {:?}", e.action, e.auditable_type, e.auditable_id));
    let cases = [
        ("POST", "/catalog/categories", Some("create catalog_category None")),
        (
            "PATCH",
            "/catalog/categories/3",
            Some("update catalog_category Some(3)"),
        ),
        (
            "DELETE",
            "/catalog/categories/3",
            Some("delete catalog_category Some(3)"),
        ),
        (
            "POST",
            "/catalog/categories/reorder",
            Some("reorder catalog_category None"),
        ),
        (
            "POST",
            "/catalog/items/7/duplicate",
            Some("duplicate catalog_item Some(7)"),
        ),
        ("POST", "/catalog/items/status", Some("status catalog_item None")),
        ("PATCH", "/catalog/groups/2", Some("update catalog_group Some(2)")),
        ("PATCH", "/catalog/settings", Some("update catalog_settings None")),
        (
            "POST",
            "/catalog/imports/7f3c-1/apply",
            Some("apply catalog_import None"),
        ),
        ("POST", "/catalog/imports", None),
        ("DELETE", "/catalog/imports/7f3c-1", None),
        ("POST", "/catalog/quote", None),
        ("GET", "/catalog/search", None),
        ("POST", "/catalog/products/1/image", None),
        ("POST", "/catalog", None),
        ("PUT", "/catalog/items/reorder", None),
    ];
    for (method, path, expected) in cases {
        assert_eq!(describe(method, path).as_deref(), expected, "{method} {path}");
    }
}
