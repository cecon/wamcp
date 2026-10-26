//! AES-256-GCM secret box. The key is a random 32-byte file in the data directory
//! (`agents.key`), created on first use and kept out of the SQLite database and its backups.
use crate::application::ports::SecretBox;
use crate::domain::error::{fail, Error, Result};
use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use ring::aead::{Aad, LessSafeKey, Nonce, UnboundKey, AES_256_GCM, NONCE_LEN};
use ring::rand::{SecureRandom, SystemRandom};
use std::path::Path;

const PREFIX: &str = "v1:";

pub struct AesSecretBox {
    key: LessSafeKey,
    random: SystemRandom,
}

impl AesSecretBox {
    pub fn from_key(bytes: &[u8; 32]) -> Self {
        let key = UnboundKey::new(&AES_256_GCM, bytes).expect("AES-256 key has 32 bytes");
        Self {
            key: LessSafeKey::new(key),
            random: SystemRandom::new(),
        }
    }

    /// A box with a fresh random key (tests, or a store that never reopens).
    pub fn generated() -> Self {
        let mut bytes = [0u8; 32];
        SystemRandom::new().fill(&mut bytes).expect("system random");
        Self::from_key(&bytes)
    }

    /// Loads the key file, creating it with a new random key when missing.
    pub fn from_file(path: &Path) -> std::io::Result<Self> {
        if !path.exists() {
            let mut bytes = [0u8; 32];
            SystemRandom::new()
                .fill(&mut bytes)
                .map_err(|_| std::io::Error::other("system random"))?;
            std::fs::write(path, STANDARD.encode(bytes))?;
        }
        let decoded = STANDARD
            .decode(std::fs::read_to_string(path)?.trim())
            .map_err(std::io::Error::other)?;
        let bytes: [u8; 32] = decoded
            .try_into()
            .map_err(|_| std::io::Error::other("agents.key must hold 32 bytes"))?;
        Ok(Self::from_key(&bytes))
    }
}

impl SecretBox for AesSecretBox {
    fn seal(&self, plain: &str) -> Result<String> {
        let mut nonce = [0u8; NONCE_LEN];
        self.random
            .fill(&mut nonce)
            .map_err(|_| Error::internal("system random"))?;
        let mut data = plain.as_bytes().to_vec();
        self.key
            .seal_in_place_append_tag(Nonce::assume_unique_for_key(nonce), Aad::empty(), &mut data)
            .map_err(|_| Error::internal("seal failed"))?;
        let mut out = nonce.to_vec();
        out.extend(data);
        Ok(format!("{PREFIX}{}", STANDARD.encode(out)))
    }

    fn open(&self, sealed: &str) -> Result<String> {
        let bytes = sealed.strip_prefix(PREFIX).and_then(|b| STANDARD.decode(b).ok());
        let Some(mut bytes) = bytes.filter(|b| b.len() > NONCE_LEN) else {
            return fail("Credencial ilegível");
        };
        let mut data = bytes.split_off(NONCE_LEN);
        let nonce = Nonce::try_assume_unique_for_key(&bytes).map_err(|_| Error::internal("nonce"))?;
        let plain = self.key.open_in_place(nonce, Aad::empty(), &mut data).map_err(|_| {
            Error::from(crate::domain::error::HelpdeskError::new(
                "Credencial não pôde ser decifrada",
            ))
        })?;
        String::from_utf8(plain.to_vec()).map_err(Error::internal)
    }
}
