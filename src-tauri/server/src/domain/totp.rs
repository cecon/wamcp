//! Time-based one-time passwords (RFC 6238: HMAC-SHA1, 30-second steps, 6 digits), as used by
//! authenticator apps, and the base32 secrets they scan.
use hmac::{Hmac, Mac};
use sha1::Sha1;

pub const STEP_SECONDS: i64 = 30;
const ALPHABET: &[u8; 32] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/// RFC 4648 base32 without padding.
pub fn base32_encode(bytes: &[u8]) -> String {
    let mut out = String::new();
    for chunk in bytes.chunks(5) {
        let mut buffer = [0u8; 5];
        buffer[..chunk.len()].copy_from_slice(chunk);
        let bits = buffer.iter().fold(0u64, |acc, b| (acc << 8) | u64::from(*b));
        let chars = (chunk.len() * 8).div_ceil(5);
        for i in 0..chars {
            out.push(ALPHABET[((bits >> (35 - i * 5)) & 31) as usize] as char);
        }
    }
    out
}

pub fn base32_decode(text: &str) -> Option<Vec<u8>> {
    let (mut bits, mut count, mut out) = (0u64, 0u32, Vec::new());
    for c in text.chars().filter(|c| *c != '=' && !c.is_whitespace()) {
        let value = ALPHABET.iter().position(|a| *a as char == c.to_ascii_uppercase())?;
        bits = (bits << 5) | value as u64;
        count += 5;
        if count >= 8 {
            count -= 8;
            out.push((bits >> count) as u8);
        }
    }
    Some(out)
}

/// The 6-digit code for a time step.
pub fn code_at(secret: &[u8], step: i64) -> String {
    let mut mac = Hmac::<Sha1>::new_from_slice(secret).expect("HMAC accepts any key length");
    mac.update(&step.to_be_bytes());
    let digest = mac.finalize().into_bytes();
    let offset = (digest[19] & 0x0f) as usize;
    let value = u32::from_be_bytes([
        digest[offset] & 0x7f,
        digest[offset + 1],
        digest[offset + 2],
        digest[offset + 3],
    ]);
    format!("{:06}", value % 1_000_000)
}

/// The step a code belongs to (one step of clock drift either way), never reusing `last_step`.
pub fn verify(secret: &[u8], code: &str, now: i64, last_step: Option<i64>) -> Option<i64> {
    let code = code.trim().replace(' ', "");
    if code.len() != 6 || !code.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    let current = now.div_euclid(STEP_SECONDS);
    (current - 1..=current + 1)
        .filter(|step| last_step.is_none_or(|last| *step > last))
        .find(|step| code_at(secret, *step) == code)
}

/// The `otpauth://` link encoded in the QR code for authenticator apps.
pub fn otpauth_uri(issuer: &str, account: &str, secret_b32: &str) -> String {
    let label = url::form_urlencoded::byte_serialize(format!("{issuer}:{account}").as_bytes()).collect::<String>();
    let issuer_param = url::form_urlencoded::byte_serialize(issuer.as_bytes()).collect::<String>();
    format!("otpauth://totp/{label}?secret={secret_b32}&issuer={issuer_param}&algorithm=SHA1&digits=6&period=30")
}
