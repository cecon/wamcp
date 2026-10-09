//! Product catalog (`/catalog`): the full menu, settings, categories, search, quote and photos.
//! Any logged-in agent reads; writes are for administrators (checked by the use cases).
use super::auth::CurrentUser;
use super::error::{created, done, ok, ApiError, ApiResult};
use super::input::{id, ids, text, Body, Query};
use super::state::AppState;
use crate::domain::menu::patch::{CategoryPatch, SettingsPatch};
use crate::domain::menu::QuoteRequest;
use axum::extract::{DefaultBodyLimit, Multipart, Path, Query as Params, State};
use axum::http::header;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, patch, post};
use axum::Router;
use serde::Deserialize;

/// Photo uploads (5 MB) plus multipart overhead.
const IMAGE_LIMIT: usize = 6 * 1024 * 1024;

async fn menu(State(state): State<AppState>, _user: CurrentUser, Params(query): Params<Query>) -> ApiResult<Response> {
    let available = query.get("available").is_some_and(|v| v == "true" || v == "1");
    ok(state.support().menu.menu(available)?)
}

async fn settings(State(state): State<AppState>, current: CurrentUser) -> ApiResult<Response> {
    ok(state.support().menu.settings(&current.actor())?)
}

async fn update_settings(
    State(state): State<AppState>,
    current: CurrentUser,
    Body(body): Body<SettingsPatch>,
) -> ApiResult<Response> {
    ok(state.support().menu.update_settings(&current.actor(), &body)?)
}

async fn categories(State(state): State<AppState>, current: CurrentUser) -> ApiResult<Response> {
    ok(state.support().menu.categories(&current.actor())?)
}

async fn create_category(
    State(state): State<AppState>,
    current: CurrentUser,
    Body(body): Body<CategoryPatch>,
) -> ApiResult<Response> {
    created(state.support().menu.create_category(&current.actor(), &body)?)
}

async fn update_category(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(category): Path<String>,
    Body(body): Body<CategoryPatch>,
) -> ApiResult<Response> {
    ok(state
        .support()
        .menu
        .update_category(&current.actor(), id(&category)?, &body)?)
}

async fn delete_category(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(category): Path<String>,
) -> ApiResult<Response> {
    state.support().menu.delete_category(&current.actor(), id(&category)?)?;
    done()
}

#[derive(Deserialize)]
struct Order {
    ids: Vec<i64>,
}

async fn reorder_categories(
    State(state): State<AppState>,
    current: CurrentUser,
    Body(body): Body<Order>,
) -> ApiResult<Response> {
    let order = ids(&body.ids, 1, 1000)?;
    ok(state.support().menu.reorder_categories(&current.actor(), &order)?)
}

async fn search(
    State(state): State<AppState>,
    current: CurrentUser,
    Params(query): Params<Query>,
) -> ApiResult<Response> {
    let q = text(query.get("q").map_or("", String::as_str), 1, 100)?;
    ok(state.support().menu.search(&current.actor(), &q, false)?)
}

async fn quote(
    State(state): State<AppState>,
    current: CurrentUser,
    Body(body): Body<QuoteRequest>,
) -> ApiResult<Response> {
    ok(state.support().menu.quote(&current.actor(), &body)?)
}

/// Multipart form with the photo in `image`.
async fn upload_image(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(product): Path<String>,
    mut form: Multipart,
) -> ApiResult<Response> {
    let product = id(&product)?;
    let mut image = None;
    while let Some(field) = form.next_field().await.map_err(|_| ApiError::TooLarge)? {
        if field.name() == Some("image") {
            image = Some(field.bytes().await.map_err(|_| ApiError::TooLarge)?);
        }
    }
    let image = image.ok_or(ApiError::Invalid)?;
    ok(state.support().menu.upload_image(&current.actor(), product, &image)?)
}

async fn delete_image(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(product): Path<String>,
) -> ApiResult<Response> {
    ok(state.support().menu.delete_image(&current.actor(), id(&product)?)?)
}

async fn image(State(state): State<AppState>, _user: CurrentUser, Path(file): Path<String>) -> ApiResult<Response> {
    let (mime, bytes) = state.support().menu.image_file(&file)?;
    let headers = [
        (header::CONTENT_TYPE, mime),
        (header::CACHE_CONTROL, "private, max-age=86400".into()),
        (header::X_CONTENT_TYPE_OPTIONS, "nosniff".into()),
    ];
    Ok((headers, bytes).into_response())
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/catalog", get(menu))
        .route("/catalog/settings", get(settings).patch(update_settings))
        .route("/catalog/categories", get(categories).post(create_category))
        .route("/catalog/categories/reorder", post(reorder_categories))
        .route(
            "/catalog/categories/{id}",
            patch(update_category).delete(delete_category),
        )
        .route("/catalog/search", get(search))
        .route("/catalog/quote", post(quote))
        .route(
            "/catalog/products/{id}/image",
            post(upload_image)
                .delete(delete_image)
                .layer(DefaultBodyLimit::max(IMAGE_LIMIT)),
        )
        .route("/catalog/images/{file}", get(image))
        .merge(super::menu_items::routes())
        .merge(super::menu_imports::routes())
}
