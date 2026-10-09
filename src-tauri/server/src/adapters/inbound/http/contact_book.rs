//! Contact notes and CSV import/export.
use super::auth::CurrentUser;
use super::error::{created, done, ok, ApiError, ApiResult};
use super::input::{id, text, Body};
use super::state::AppState;
use axum::extract::{DefaultBodyLimit, Multipart, Path, State};
use axum::http::header;
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, post};
use axum::Router;
use serde::Deserialize;

/// CSV imports up to 5 MiB.
const IMPORT_LIMIT: usize = 5 * 1024 * 1024;

async fn notes(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(contact): Path<String>,
) -> ApiResult<Response> {
    ok(state
        .support()
        .helpdesk
        .contact_notes(&current.actor(), id(&contact)?)?)
}

#[derive(Deserialize)]
struct Note {
    content: String,
}

async fn add_note(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(contact): Path<String>,
    Body(body): Body<Note>,
) -> ApiResult<Response> {
    let content = text(&body.content, 1, 5000)?;
    created(
        state
            .support()
            .helpdesk
            .add_contact_note(&current.actor(), id(&contact)?, &content)?,
    )
}

async fn delete_note(
    State(state): State<AppState>,
    current: CurrentUser,
    Path((contact, note)): Path<(String, String)>,
) -> ApiResult<Response> {
    state
        .support()
        .helpdesk
        .delete_contact_note(&current.actor(), id(&contact)?, id(&note)?)?;
    done()
}

async fn export(State(state): State<AppState>, current: CurrentUser) -> ApiResult<Response> {
    let csv = state.support().helpdesk.export_contacts(&current.actor())?;
    let headers = [
        (header::CONTENT_TYPE, "text/csv; charset=utf-8"),
        (header::CONTENT_DISPOSITION, "attachment; filename=\"contatos.csv\""),
    ];
    Ok((headers, csv).into_response())
}

/// Multipart form with the CSV in `import_file` (Chatwoot's field name) or `file`.
async fn import(State(state): State<AppState>, current: CurrentUser, mut form: Multipart) -> ApiResult<Response> {
    let mut csv = None;
    while let Some(field) = form.next_field().await.map_err(|_| ApiError::TooLarge)? {
        if matches!(field.name(), Some("import_file" | "file")) {
            let bytes = field.bytes().await.map_err(|_| ApiError::TooLarge)?;
            csv = Some(String::from_utf8(bytes.to_vec()).map_err(|_| ApiError::Invalid)?);
        }
    }
    let csv = csv.ok_or(ApiError::Invalid)?;
    ok(state.support().helpdesk.import_contacts(&current.actor(), &csv)?)
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/contacts/{id}/notes", get(notes).post(add_note))
        .route("/contacts/{id}/notes/{note}", delete(delete_note))
        .route("/contacts/export", get(export))
        .route(
            "/contacts/import",
            post(import).layer(DefaultBodyLimit::max(IMPORT_LIMIT)),
        )
}
