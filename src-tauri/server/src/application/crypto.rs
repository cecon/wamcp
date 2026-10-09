//! Hashing and random secrets shared by the use cases (pure library calls, no I/O).
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use rand::RngCore;
use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq;

pub fn sha256_hex(value: &str) -> String {
    hex::encode(Sha256::digest(value.as_bytes()))
}

pub fn random_bytes(length: usize) -> Vec<u8> {
    let mut bytes = vec![0u8; length];
    rand::rng().fill_bytes(&mut bytes);
    bytes
}

/// 32 random bytes as base64url (43 characters), like Node's `randomBytes(32).toString('base64url')`.
pub fn random_secret() -> String {
    base64url(&random_bytes(32))
}

pub fn base64url(bytes: &[u8]) -> String {
    URL_SAFE_NO_PAD.encode(bytes)
}

/// Constant-time comparison; empty values never match.
pub fn same_secret(a: &str, b: &str) -> bool {
    !a.is_empty() && a.len() == b.len() && bool::from(a.as_bytes().ct_eq(b.as_bytes()))
}
