//! Downloads catalog photos over https with a timeout, a 5 MB limit and an image content type;
//! redirects are followed only to other allowed addresses. An in-memory fake serves tests.
use crate::application::ports::ImageFetcher;
use crate::domain::error::{fail, Result};
use crate::domain::menu::images::{image_allowed, MAX_IMAGE_BYTES};
use async_trait::async_trait;
use parking_lot::Mutex;
use std::collections::HashMap;
use std::time::Duration;

pub struct HttpImageFetcher {
    client: reqwest::Client,
}

impl HttpImageFetcher {
    pub fn new() -> Self {
        let policy = reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() >= 3 || !image_allowed(attempt.url().as_str()) {
                attempt.stop()
            } else {
                attempt.follow()
            }
        });
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(20))
            .redirect(policy)
            .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) wamcp-catalog")
            .build()
            .unwrap_or_default();
        Self { client }
    }
}

impl Default for HttpImageFetcher {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl ImageFetcher for HttpImageFetcher {
    async fn fetch(&self, url: &str) -> Result<Vec<u8>> {
        if !image_allowed(url) {
            return fail("Endereço de imagem não permitido");
        }
        let Ok(mut response) = self.client.get(url).send().await else {
            return fail("Não foi possível baixar a imagem");
        };
        let content_type = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .unwrap_or_default()
            .to_ascii_lowercase();
        if !response.status().is_success() || !content_type.starts_with("image/") {
            return fail("O endereço não devolveu uma imagem");
        }
        if response.content_length().unwrap_or(0) > MAX_IMAGE_BYTES as u64 {
            return fail("A imagem deve ter até 5 MB");
        }
        let mut bytes = Vec::new();
        while let Ok(Some(chunk)) = response.chunk().await {
            bytes.extend_from_slice(&chunk);
            if bytes.len() > MAX_IMAGE_BYTES {
                return fail("A imagem deve ter até 5 MB");
            }
        }
        Ok(bytes)
    }
}

/// Serves registered URLs from memory and records every request.
#[derive(Default)]
pub struct MemoryImageFetcher {
    pub images: Mutex<HashMap<String, Vec<u8>>>,
    pub requests: Mutex<Vec<String>>,
}

#[async_trait]
impl ImageFetcher for MemoryImageFetcher {
    async fn fetch(&self, url: &str) -> Result<Vec<u8>> {
        self.requests.lock().push(url.into());
        match self.images.lock().get(url) {
            Some(bytes) => Ok(bytes.clone()),
            None => fail("Não foi possível baixar a imagem"),
        }
    }
}
