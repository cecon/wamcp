//! Destination checks for MCP event callbacks: HTTPS only and never a private, loopback,
//! link-local, documentation or other special-purpose address (SSRF protection).
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};

fn in_v4(ip: Ipv4Addr, base: [u8; 4], prefix: u32) -> bool {
    let mask = if prefix == 0 { 0 } else { u32::MAX << (32 - prefix) };
    (u32::from(ip) & mask) == (u32::from(Ipv4Addr::from(base)) & mask)
}

fn in_v6(ip: Ipv6Addr, base: Ipv6Addr, prefix: u32) -> bool {
    let mask = if prefix == 0 { 0 } else { u128::MAX << (128 - prefix) };
    (u128::from(ip) & mask) == (u128::from(base) & mask)
}

/// IANA special-purpose IPv4 ranges, plus Azure's platform address.
const DENIED_V4: [([u8; 4], u32); 16] = [
    ([0, 0, 0, 0], 8),
    ([10, 0, 0, 0], 8),
    ([100, 64, 0, 0], 10),
    ([127, 0, 0, 0], 8),
    ([168, 63, 129, 16], 32),
    ([169, 254, 0, 0], 16),
    ([172, 16, 0, 0], 12),
    ([192, 0, 0, 0], 24),
    ([192, 0, 2, 0], 24),
    ([192, 88, 99, 0], 24),
    ([192, 168, 0, 0], 16),
    ([198, 18, 0, 0], 15),
    ([198, 51, 100, 0], 24),
    ([203, 0, 113, 0], 24),
    ([224, 0, 0, 0], 4),
    ([240, 0, 0, 0], 4),
];

const DENIED_V6: [(Ipv6Addr, u32); 4] = [
    (Ipv6Addr::new(0x2001, 0, 0, 0, 0, 0, 0, 0), 23),
    (Ipv6Addr::new(0x2001, 0xdb8, 0, 0, 0, 0, 0, 0), 32),
    (Ipv6Addr::new(0x2002, 0, 0, 0, 0, 0, 0, 0), 16),
    (Ipv6Addr::new(0x3fff, 0, 0, 0, 0, 0, 0, 0), 20),
];

/// Only public unicast: IPv4 outside the special ranges, IPv6 global unicast (2000::/3).
pub fn public_address(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => !DENIED_V4.iter().any(|(base, prefix)| in_v4(v4, *base, *prefix)),
        IpAddr::V6(v6) => {
            in_v6(v6, Ipv6Addr::new(0x2000, 0, 0, 0, 0, 0, 0, 0), 3)
                && !DENIED_V6.iter().any(|(base, prefix)| in_v6(v6, *base, *prefix))
        }
    }
}

/// A validated callback: the URL and its host (without IPv6 brackets).
pub struct CallbackUrl {
    pub url: url::Url,
    pub host: String,
}

pub fn callback_url(value: &str) -> Option<CallbackUrl> {
    if value.len() > 8192 {
        return None;
    }
    let url = url::Url::parse(value).ok()?;
    if url.scheme() != "https" || !url.username().is_empty() || url.password().is_some() || url.fragment().is_some() {
        return None;
    }
    let host = url
        .host_str()?
        .trim_start_matches('[')
        .trim_end_matches(']')
        .to_string();
    if let Ok(ip) = host.parse::<IpAddr>() {
        if !public_address(ip) {
            return None;
        }
    }
    Some(CallbackUrl { url, host })
}

/// Resolves the host and returns the address to connect to, only when every answer is public.
pub async fn resolve_callback(target: &CallbackUrl) -> Option<SocketAddr> {
    let port = target.url.port_or_known_default().unwrap_or(443);
    if let Ok(ip) = target.host.parse::<IpAddr>() {
        return Some(SocketAddr::new(ip, port));
    }
    let addresses: Vec<SocketAddr> = tokio::net::lookup_host((target.host.as_str(), port))
        .await
        .ok()?
        .collect();
    if addresses.is_empty() || addresses.len() > 64 || addresses.iter().any(|a| !public_address(a.ip())) {
        return None;
    }
    addresses.first().copied()
}
