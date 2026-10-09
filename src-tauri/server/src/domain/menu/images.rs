//! Product photos: accepted formats (checked by their magic bytes), size limit, storage paths and
//! where iFood photos are downloaded from.
use crate::domain::error::{fail, Result};

pub const MAX_IMAGE_BYTES: usize = 5 * 1024 * 1024;
/// iFood's CDN for the consumer `logoUrl` (a relative file name).
pub const IFOOD_IMAGES: &str = "https://static-images.ifood.com.br/image/upload/t_high/pratos/";

/// MIME type and extension of a PNG, JPEG or WebP file, from its first bytes.
pub fn image_kind(bytes: &[u8]) -> Option<(&'static str, &'static str)> {
    if bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]) {
        Some(("image/png", "png"))
    } else if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some(("image/jpeg", "jpg"))
    } else if bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some(("image/webp", "webp"))
    } else {
        None
    }
}

/// Validates an uploaded or downloaded photo and returns its MIME type and extension.
pub fn check_image(bytes: &[u8]) -> Result<(&'static str, &'static str)> {
    if bytes.is_empty() {
        return fail("A imagem está vazia");
    }
    if bytes.len() > MAX_IMAGE_BYTES {
        return fail("A imagem deve ter até 5 MB");
    }
    match image_kind(bytes) {
        Some(kind) => Ok(kind),
        None => fail("Envie uma imagem PNG, JPG ou WebP"),
    }
}

/// Storage path of a photo file (`catalog/<file>`); only plain generated names are accepted.
pub fn image_path(file: &str) -> Option<String> {
    let valid = !file.is_empty()
        && file.len() <= 80
        && file
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
        && !file.starts_with('.')
        && !file.contains("..");
    valid.then(|| format!("catalog/{file}"))
}

/// Download URL of an iFood photo: absolute https URLs as they are, relative names on the iFood CDN.
pub fn image_source(logo: &str) -> Option<String> {
    let logo = logo.trim();
    if logo.is_empty() {
        return None;
    }
    if logo.starts_with("http://") || logo.starts_with("https://") {
        return image_allowed(logo).then(|| logo.to_string());
    }
    let relative = logo.trim_start_matches('/').trim_start_matches("pratos/");
    Some(format!("{IFOOD_IMAGES}{relative}"))
}

/// Photos are only fetched over https from public host names (no IPs or localhost).
pub fn image_allowed(address: &str) -> bool {
    let Ok(parsed) = url::Url::parse(address) else {
        return false;
    };
    let Some(url::Host::Domain(host)) = parsed.host() else {
        return false;
    };
    parsed.scheme() == "https" && host.contains('.') && !host.ends_with(".localhost") && host != "localhost"
}
