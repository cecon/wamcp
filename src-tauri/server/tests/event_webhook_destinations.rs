//! MCP event callbacks: SSRF-safe destination validation. Network I/O is out of scope: loopback is
//! unreachable by design, so the pure `prepare`/address functions are tested.
mod event_webhook_support;

use event_webhook_support::{event, reason, secret, SUBSCRIPTION, URL};
use std::net::{IpAddr, SocketAddr};
use wamcp_server::adapters::outbound::callback_address::{callback_url, public_address, resolve_callback};
use wamcp_server::adapters::outbound::event_callback::{prepare, HttpEventCallback};
use wamcp_server::application::ports::EventCallback;

const DENIED: [&str; 45] = [
    "0.0.0.0",
    "0.9.8.7",
    "10.1.2.3",
    "100.64.0.1",
    "100.127.255.254",
    "127.0.0.1",
    "168.63.129.16",
    "169.254.169.254",
    "172.16.0.1",
    "172.31.255.254",
    "192.0.0.1",
    "192.0.2.1",
    "192.88.99.1",
    "192.168.1.1",
    "198.18.0.1",
    "198.19.255.1",
    "198.51.100.1",
    "203.0.113.1",
    "224.0.0.1",
    "239.255.255.255",
    "240.0.0.1",
    "255.255.255.255",
    "::",
    "::1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "::ffff:169.254.169.254",
    "::ffff:8.8.8.8",
    "::127.0.0.1",
    "64:ff9b::7f00:1",
    "64:ff9b:1::a00:1",
    "100::1",
    "2001::1",
    "2001:2::1",
    "2001:10::1",
    "2001:db8::1",
    "2002:7f00:1::",
    "3fff::1",
    "5f00::1",
    "fc00::1",
    "fdff::1",
    "fe80::1",
    "ff02::1",
    "fe80::1%lo",
    "2001:4860::1%lo",
];

/// Node's `publicAddress` takes strings; zone-scoped literals do not parse as `IpAddr` and are denied.
fn public(address: &str) -> bool {
    address.parse::<IpAddr>().is_ok_and(public_address)
}

#[test]
fn address_classification_rejects_private_local_reserved_mapped_and_transition_ips() {
    for address in DENIED {
        assert!(!public(address), "{address}");
    }
    let allowed = [
        "8.8.8.8",
        "93.184.216.34",
        "100.63.255.254",
        "100.128.0.1",
        "172.15.255.255",
        "172.32.0.1",
        "2606:4700:4700::1111",
        "2001:4860:4860::8888",
    ];
    for address in allowed {
        assert!(public(address), "{address}");
    }
}

#[test]
fn https_only_url_validation_rejects_credentials_fragments_and_disguised_local_literals() {
    let long = format!("https://receiver.example.com/{}", "a".repeat(8192));
    let urls = [
        "http://8.8.8.8/",
        "file:///etc/passwd",
        "ftp://receiver.example.com/",
        "https://user:password@receiver.example.com/",
        "https://receiver.example.com/#fragment",
        "https://127.1/",
        "https://2130706433/",
        "https://0x7f000001/",
        "https://0177.0.0.1/",
        "https://[::1]/",
        "https://[::ffff:127.0.0.1]/",
        "https://[::ffff:7f00:1]/",
        "https://[fe80::1%25lo]/",
        "",
        "not a url",
        long.as_str(),
    ];
    for url in urls {
        assert!(callback_url(url).is_none(), "{url}");
        let result = prepare(url, SUBSCRIPTION, &[secret(7, 32)], &event(), "evt_test", "1");
        assert_eq!(reason(result), "invalid_url", "{url}");
    }
    for denied in DENIED.iter().filter(|a| !a.contains('%')) {
        let host = if denied.contains(':') {
            format!("[{denied}]")
        } else {
            denied.to_string()
        };
        assert!(callback_url(&format!("https://{host}/")).is_none(), "{denied}");
    }
}

#[tokio::test]
async fn public_ipv4_and_ipv6_literals_skip_dns_and_keep_the_port() {
    for (url, host, expected) in [
        ("https://8.8.8.8/", "8.8.8.8", "8.8.8.8:443"),
        (
            "https://[2606:4700:4700::1111]:8443/x",
            "2606:4700:4700::1111",
            "[2606:4700:4700::1111]:8443",
        ),
    ] {
        let target = callback_url(url).expect("valid");
        assert_eq!(target.host, host);
        let pinned = resolve_callback(&target).await.expect("resolved");
        assert_eq!(pinned, expected.parse::<SocketAddr>().expect("socket"));
    }
    let named = callback_url(URL).expect("named");
    assert_eq!(named.host, "receiver.example.com");
    assert_eq!(named.url.port(), Some(8443));
}

#[tokio::test]
async fn hostnames_resolving_to_loopback_are_blocked() {
    let target = callback_url("https://localhost/").expect("hostname passes syntax");
    assert!(resolve_callback(&target).await.is_none());
}

#[tokio::test]
async fn http_callback_rejects_non_https_private_and_local_destinations_as_invalid_url() {
    let callback = HttpEventCallback;
    let urls = [
        "http://8.8.8.8/",
        "https://10.0.0.1/",
        "https://127.0.0.1/",
        "https://[::1]/",
        "https://localhost/",
    ];
    for url in urls {
        let verify = callback
            .verify(url, SUBSCRIPTION, &secret(7, 32))
            .await
            .expect_err("verify");
        assert_eq!(verify.reason, "invalid_url", "{url}");
        let deliver = callback
            .deliver(url, SUBSCRIPTION, &[secret(7, 32)], &event())
            .await
            .expect_err("deliver");
        assert_eq!(deliver.reason, "invalid_url", "{url}");
    }
}
