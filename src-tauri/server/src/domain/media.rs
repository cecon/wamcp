//! Attachments: file kinds, WhatsApp size limits and where files live under the data directory.
use super::error::{fail, Result};

/// Chatwoot attachment kinds (`file_type`).
pub const FILE_TYPES: [&str; 6] = ["image", "audio", "video", "file", "sticker", "location"];

/// The attachment kind for a MIME type (documents are `file`).
pub fn file_type_for(mime: &str) -> &'static str {
    let mime = mime.to_ascii_lowercase();
    if mime == "image/webp" {
        "sticker"
    } else if mime.starts_with("image/") {
        "image"
    } else if mime.starts_with("audio/") {
        "audio"
    } else if mime.starts_with("video/") {
        "video"
    } else {
        "file"
    }
}

/// Upper bound accepted by WhatsApp for each kind (bytes).
pub fn max_bytes(file_type: &str) -> u64 {
    const MIB: u64 = 1024 * 1024;
    match file_type {
        "image" => 16 * MIB,
        "audio" | "video" => 64 * MIB,
        "sticker" => MIB,
        _ => 100 * MIB,
    }
}

/// Rejects empty uploads and files over the WhatsApp limit of their kind.
pub fn validate_upload(mime: &str, size: u64) -> Result<&'static str> {
    let kind = file_type_for(mime);
    if size == 0 {
        return fail("O arquivo está vazio");
    }
    if size > max_bytes(kind) {
        return fail(format!(
            "O arquivo excede o limite de {} MiB do WhatsApp",
            max_bytes(kind) / (1024 * 1024)
        ));
    }
    Ok(kind)
}

/// File extension for a MIME type, falling back to the original file name's extension.
pub fn extension(mime: &str, file_name: Option<&str>) -> String {
    let base = mime.split(';').next().unwrap_or_default().trim().to_ascii_lowercase();
    let known = match base.as_str() {
        "image/jpeg" => "jpg",
        "image/png" => "png",
        "image/webp" => "webp",
        "image/gif" => "gif",
        "audio/ogg" => "ogg",
        "audio/mpeg" => "mp3",
        "audio/mp4" | "audio/aac" => "m4a",
        "audio/webm" => "webm",
        "video/mp4" => "mp4",
        "video/3gpp" => "3gp",
        "application/pdf" => "pdf",
        _ => "",
    };
    if !known.is_empty() {
        return known.into();
    }
    let from_name = file_name
        .and_then(|n| n.rsplit_once('.'))
        .map(|(_, e)| e.to_ascii_lowercase());
    from_name
        .filter(|e| (1..=8).contains(&e.len()) && e.chars().all(|c| c.is_ascii_alphanumeric()))
        .unwrap_or_else(|| "bin".into())
}

/// Keeps letters, digits, `-` and `_` so ids are safe as path segments.
pub fn safe_segment(value: &str) -> String {
    let cleaned: String = value
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .take(80)
        .collect();
    if cleaned.is_empty() {
        "_".into()
    } else {
        cleaned
    }
}

/// Relative storage path: `media/<session>/<YYYY>/<MM>/<message id>.<ext>`, organised by month.
pub fn storage_path(session_id: &str, epoch_seconds: i64, message_id: &str, extension: &str) -> String {
    let date = chrono::DateTime::from_timestamp(epoch_seconds, 0).unwrap_or_default();
    format!(
        "media/{}/{}/{}.{}",
        safe_segment(session_id),
        date.format("%Y/%m"),
        safe_segment(message_id),
        safe_segment(extension)
    )
}

/// A file name for downloads (no path separators or control characters).
pub fn display_name(file_name: Option<&str>, file_type: &str, extension: &str) -> String {
    let name: String = file_name
        .unwrap_or_default()
        .chars()
        .filter(|c| !c.is_control() && !matches!(c, '/' | '\\' | '"'))
        .take(120)
        .collect();
    if name.trim().is_empty() {
        format!("{file_type}.{extension}")
    } else {
        name
    }
}
