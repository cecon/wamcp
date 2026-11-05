//! The JWT a GitHub App signs with its private key (RS256) to call the API as itself: it lasts nine
//! minutes and is only used to read the App's webhook deliveries and to get installation tokens.
use crate::domain::error::{fail, Result};
use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
use base64::Engine;
use ring::rand::SystemRandom;
use ring::signature::{RsaKeyPair, RSA_PKCS1_SHA256};
use serde_json::json;

fn key(pem: &str) -> Result<RsaKeyPair> {
    let body: String = pem.lines().filter(|l| !l.starts_with("-----")).collect();
    let Ok(der) = STANDARD.decode(body.trim()) else {
        return fail("Chave privada do GitHub App inválida");
    };
    // GitHub hands out PKCS#1 ("RSA PRIVATE KEY"); PKCS#8 is accepted as well.
    match RsaKeyPair::from_der(&der).or_else(|_| RsaKeyPair::from_pkcs8(&der)) {
        Ok(key) => Ok(key),
        Err(_) => fail("Chave privada do GitHub App inválida"),
    }
}

/// `iat` a minute in the past absorbs clock drift, as GitHub recommends.
pub fn app_jwt(app_id: i64, pem: &str, now_secs: i64) -> Result<String> {
    let key = key(pem)?;
    let header = URL_SAFE_NO_PAD.encode(json!({ "alg": "RS256", "typ": "JWT" }).to_string());
    let claims = json!({ "iat": now_secs - 60, "exp": now_secs + 540, "iss": app_id.to_string() });
    let input = format!("{header}.{}", URL_SAFE_NO_PAD.encode(claims.to_string()));
    let mut signature = vec![0; key.public().modulus_len()];
    if key
        .sign(
            &RSA_PKCS1_SHA256,
            &SystemRandom::new(),
            input.as_bytes(),
            &mut signature,
        )
        .is_err()
    {
        return fail("Não foi possível assinar o token do GitHub App");
    }
    Ok(format!("{input}.{}", URL_SAFE_NO_PAD.encode(signature)))
}
