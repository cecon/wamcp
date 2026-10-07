//! scrypt password hashing stored as `scrypt$<salt>$<hash>` (base64url), compatible with the hashes
//! written by the Node version (N=16384, r=8, p=1, 64-byte key).
use crate::application::crypto::{base64url, random_bytes};
use crate::application::ports::PasswordHasher;
use crate::domain::error::{Error, Result};
use async_trait::async_trait;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use subtle::ConstantTimeEq;

const KEY_LENGTH: usize = 64;

fn derive(password: &[u8], salt: &[u8]) -> Option<Vec<u8>> {
    let params = scrypt::Params::new(14, 8, 1, KEY_LENGTH).ok()?;
    let mut key = vec![0u8; KEY_LENGTH];
    scrypt::scrypt(password, salt, &params, &mut key).ok()?;
    Some(key)
}

pub struct ScryptHasher;

#[async_trait]
impl PasswordHasher for ScryptHasher {
    async fn hash(&self, password: &str) -> Result<String> {
        let password = password.as_bytes().to_vec();
        tokio::task::spawn_blocking(move || {
            let salt = random_bytes(16);
            let key = derive(&password, &salt).ok_or_else(|| Error::internal("scrypt failed"))?;
            Ok(format!("scrypt${}${}", base64url(&salt), base64url(&key)))
        })
        .await
        .map_err(Error::internal)?
    }

    async fn verify(&self, password: &str, stored: &str) -> bool {
        let parts: Vec<&str> = stored.split('$').collect();
        let [scheme, salt, hash] = parts.as_slice() else {
            return false;
        };
        let (Ok(salt), Ok(expected)) = (URL_SAFE_NO_PAD.decode(salt), URL_SAFE_NO_PAD.decode(hash)) else {
            return false;
        };
        if *scheme != "scrypt" || salt.is_empty() || expected.is_empty() {
            return false;
        }
        let password = password.as_bytes().to_vec();
        let key = tokio::task::spawn_blocking(move || derive(&password, &salt)).await;
        matches!(key, Ok(Some(key)) if key.len() == expected.len() && bool::from(key.ct_eq(&expected)))
    }
}
