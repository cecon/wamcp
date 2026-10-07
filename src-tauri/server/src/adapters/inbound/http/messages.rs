//! Sending messages (JSON, or multipart with files and voice notes) and serving attachments.
use super::auth::CurrentUser;
use super::error::{created, ApiError, ApiResult};
use super::input::{id, is_json, text, BODY_LIMIT};
use super::state::AppState;
use crate::application::replies::Draft;
use crate::domain::media::{display_name, extension};
use crate::domain::model::Upload;
use axum::body::Bytes;
use axum::extract::{FromRequest, Multipart, Path, Request, State};
use axum::http::header;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::Router;
use serde::Deserialize;

/// Files up to 100 MiB (the WhatsApp document limit) plus form overhead.
pub const UPLOAD_LIMIT: usize = 101 * 1024 * 1024;

#[derive(Deserialize)]
struct Reply {
    content: Option<String>,
    #[serde(default)]
    private: bool,
    in_reply_to: Option<i64>,
}

fn flag(value: &str) -> bool {
    matches!(value, "true" | "1" | "on")
}

/// Reads the multipart form: `content`, `private`, `in_reply_to`, `voice` and `attachments[]`.
async fn form(request: Request, state: &AppState) -> ApiResult<(Draft, Vec<Upload>)> {
    let mut multipart = Multipart::from_request(request, state)
        .await
        .map_err(|_| ApiError::Invalid)?;
    let (mut draft, mut uploads, mut voice) = (Draft::default(), Vec::new(), false);
    while let Some(field) = multipart.next_field().await.map_err(|_| ApiError::TooLarge)? {
        let name = field.name().unwrap_or_default().to_string();
        if name.starts_with("attachments") {
            let file_name = field.file_name().map(String::from);
            let mime = field.content_type().unwrap_or("application/octet-stream").to_string();
            let bytes = field.bytes().await.map_err(|_| ApiError::TooLarge)?;
            uploads.push(Upload {
                file_name,
                mime_type: mime,
                bytes: bytes.to_vec(),
                voice: false,
            });
            continue;
        }
        let value = field.text().await.map_err(|_| ApiError::Invalid)?;
        match name.as_str() {
            "content" => draft.content = Some(value),
            "private" => draft.private = flag(&value),
            "voice" => voice = flag(&value),
            "in_reply_to" => draft.in_reply_to = Some(id(&value)?),
            _ => {}
        }
    }
    for upload in &mut uploads {
        upload.voice = voice;
    }
    Ok((draft, uploads))
}

async fn reply(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(display): Path<String>,
    request: Request,
) -> ApiResult<Response> {
    let display = id(&display)?;
    let content_type = request
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or_default();
    let (mut draft, uploads) = if content_type.starts_with("multipart/form-data") {
        form(request, &state).await?
    } else {
        if !is_json(Some(content_type)) {
            return Err(ApiError::Invalid);
        }
        let bytes = Bytes::from_request(request, &state)
            .await
            .map_err(|_| ApiError::TooLarge)?;
        if bytes.len() > BODY_LIMIT {
            return Err(ApiError::TooLarge);
        }
        let body: Reply = serde_json::from_slice(&bytes).map_err(|_| ApiError::Invalid)?;
        let draft = Draft {
            content: body.content,
            private: body.private,
            in_reply_to: body.in_reply_to,
            upload: None,
        };
        (draft, Vec::new())
    };
    draft.content = draft
        .content
        .as_deref()
        .map(|c| text(c, 0, 4096))
        .transpose()?
        .filter(|c| !c.is_empty());
    if draft.content.is_none() && uploads.is_empty() {
        return Err(ApiError::Invalid);
    }
    let helpdesk = &state.support().helpdesk;
    let actor = current.actor();
    if uploads.is_empty() {
        return created(helpdesk.send_draft(&actor, display, draft).await?);
    }
    // WhatsApp carries one file per message: the caption and the quote go with the first one.
    let mut first = None;
    for (index, upload) in uploads.into_iter().enumerate() {
        let part = Draft {
            content: if index == 0 { draft.content.clone() } else { None },
            in_reply_to: if index == 0 { draft.in_reply_to } else { None },
            private: draft.private,
            upload: Some(upload),
        };
        let message = helpdesk.send_draft(&actor, display, part).await?;
        first.get_or_insert(message);
    }
    created(first)
}

async fn attachment(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(attachment): Path<String>,
) -> ApiResult<Response> {
    let id = id(&attachment)?;
    let (attachment, bytes) = state.support().helpdesk.attachment_file(&current.actor(), id).await?;
    let ext = extension(&attachment.mime_type, attachment.file_name.as_deref());
    let name = display_name(attachment.file_name.as_deref(), &attachment.file_type, &ext);
    let encoded: String = url::form_urlencoded::byte_serialize(name.as_bytes()).collect();
    let disposition = format!("inline; filename=\"{name}\"; filename*=UTF-8''{encoded}");
    let headers = [
        (header::CONTENT_TYPE, attachment.mime_type.clone()),
        (header::CONTENT_DISPOSITION, disposition),
        (header::CACHE_CONTROL, "private, max-age=86400".into()),
        (header::X_CONTENT_TYPE_OPTIONS, "nosniff".into()),
    ];
    Ok((headers, bytes).into_response())
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/conversations/{id}/messages", post(reply))
        .route("/attachments/{id}", get(attachment))
        .layer(axum::extract::DefaultBodyLimit::max(UPLOAD_LIMIT))
}
