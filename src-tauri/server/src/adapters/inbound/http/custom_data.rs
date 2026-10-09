//! Advanced filters, saved views (`/custom_filters`) and custom attributes
//! (`/custom_attribute_definitions`, `/conversations/{id}/custom_attributes`).
use super::auth::CurrentUser;
use super::error::{done, ok, ApiResult};
use super::input::{check, id, int_param, nullable_text, one_of, optional_text, text, Body, Query};
use super::state::AppState;
use crate::application::custom_data::NewDefinition;
use crate::domain::filters::{ATTRIBUTE_MODELS, DISPLAY_TYPES};
use crate::domain::model::{AttributeFields, Condition};
use axum::extract::{Path, Query as Params, State};
use axum::response::Response;
use axum::routing::{patch, post};
use axum::Router;
use serde::Deserialize;
use serde_json::{Map, Value};

const FILTER_TYPES: [&str; 2] = ["conversation", "contact"];

#[derive(Deserialize)]
struct Filter {
    payload: Vec<Condition>,
}

async fn filter_conversations(
    State(state): State<AppState>,
    current: CurrentUser,
    Params(query): Params<Query>,
    Body(body): Body<Filter>,
) -> ApiResult<Response> {
    let page = int_param(&query, "page", 1, 1, 10_000)?;
    ok(state
        .support()
        .helpdesk
        .filter_conversations(&current.actor(), body.payload, page)?)
}

async fn filter_contacts(
    State(state): State<AppState>,
    current: CurrentUser,
    Params(query): Params<Query>,
    Body(body): Body<Filter>,
) -> ApiResult<Response> {
    let page = int_param(&query, "page", 1, 1, 10_000)?;
    ok(state
        .support()
        .helpdesk
        .filter_contacts(&current.actor(), body.payload, page)?)
}

async fn views(
    State(state): State<AppState>,
    current: CurrentUser,
    Params(query): Params<Query>,
) -> ApiResult<Response> {
    let kind = query.get("filter_type").map(|k| one_of(k, &FILTER_TYPES)).transpose()?;
    ok(state
        .support()
        .helpdesk
        .custom_filters(&current.actor(), kind.as_deref())?)
}

#[derive(Deserialize)]
struct View {
    name: Option<String>,
    filter_type: Option<String>,
    query: Option<Value>,
}

async fn create_view(
    State(state): State<AppState>,
    current: CurrentUser,
    Body(body): Body<View>,
) -> ApiResult<Response> {
    let name = text(body.name.as_deref().unwrap_or_default(), 1, 80)?;
    let kind = one_of(body.filter_type.as_deref().unwrap_or("conversation"), &FILTER_TYPES)?;
    let query = body.query.unwrap_or(Value::Null);
    ok(state
        .support()
        .helpdesk
        .create_custom_filter(&current.actor(), &name, &kind, &query)?)
}

async fn update_view(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(view): Path<String>,
    Body(body): Body<View>,
) -> ApiResult<Response> {
    let name = optional_text(body.name.as_deref(), 1, 80)?;
    check(name.is_some() || body.query.is_some())?;
    ok(state.support().helpdesk.update_custom_filter(
        &current.actor(),
        id(&view)?,
        name.as_deref(),
        body.query.as_ref(),
    )?)
}

async fn delete_view(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(view): Path<String>,
) -> ApiResult<Response> {
    state
        .support()
        .helpdesk
        .delete_custom_filter(&current.actor(), id(&view)?)?;
    done()
}

async fn definitions(
    State(state): State<AppState>,
    _user: CurrentUser,
    Params(query): Params<Query>,
) -> ApiResult<Response> {
    let model = query
        .get("attribute_model")
        .map(|m| one_of(m, &ATTRIBUTE_MODELS))
        .transpose()?;
    ok(state.support().helpdesk.attribute_definitions(model.as_deref())?)
}

#[derive(Deserialize)]
struct Definition {
    attribute_display_name: Option<String>,
    attribute_key: Option<String>,
    attribute_model: Option<String>,
    attribute_display_type: Option<String>,
    #[serde(default, deserialize_with = "crate::domain::model::nullable")]
    attribute_description: Option<Option<String>>,
    attribute_values: Option<Vec<String>>,
    #[serde(default, deserialize_with = "crate::domain::model::nullable")]
    regex_pattern: Option<Option<String>>,
    #[serde(default, deserialize_with = "crate::domain::model::nullable")]
    regex_cue: Option<Option<String>>,
}

fn fields(body: &Definition) -> ApiResult<AttributeFields> {
    Ok(AttributeFields {
        display_name: optional_text(body.attribute_display_name.as_deref(), 1, 80)?,
        description: nullable_text(body.attribute_description.clone(), 500)?,
        values: body.attribute_values.clone(),
        regex_pattern: body.regex_pattern.clone(),
        regex_cue: nullable_text(body.regex_cue.clone(), 200)?,
    })
}

async fn create_definition(
    State(state): State<AppState>,
    current: CurrentUser,
    Body(body): Body<Definition>,
) -> ApiResult<Response> {
    let new = NewDefinition {
        display_name: text(body.attribute_display_name.as_deref().unwrap_or_default(), 1, 80)?,
        key: optional_text(body.attribute_key.as_deref(), 1, 60)?,
        model: one_of(body.attribute_model.as_deref().unwrap_or_default(), &ATTRIBUTE_MODELS)?,
        display_type: one_of(body.attribute_display_type.as_deref().unwrap_or("text"), &DISPLAY_TYPES)?,
        fields: fields(&body)?,
    };
    ok(state
        .support()
        .helpdesk
        .create_attribute_definition(&current.actor(), new)?)
}

async fn update_definition(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(definition): Path<String>,
    Body(body): Body<Definition>,
) -> ApiResult<Response> {
    ok(state
        .support()
        .helpdesk
        .update_attribute_definition(&current.actor(), id(&definition)?, &fields(&body)?)?)
}

async fn delete_definition(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(definition): Path<String>,
) -> ApiResult<Response> {
    state
        .support()
        .helpdesk
        .delete_attribute_definition(&current.actor(), id(&definition)?)?;
    done()
}

#[derive(Deserialize)]
struct Attributes {
    custom_attributes: Map<String, Value>,
}

async fn conversation_attributes(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(display): Path<String>,
    Body(body): Body<Attributes>,
) -> ApiResult<Response> {
    ok(state.support().helpdesk.set_conversation_attributes(
        &current.actor(),
        id(&display)?,
        &body.custom_attributes,
    )?)
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/conversations/filter", post(filter_conversations))
        .route("/contacts/filter", post(filter_contacts))
        .route("/custom_filters", post(create_view).get(views))
        .route("/custom_filters/{id}", patch(update_view).delete(delete_view))
        .route(
            "/custom_attribute_definitions",
            post(create_definition).get(definitions),
        )
        .route(
            "/custom_attribute_definitions/{id}",
            patch(update_definition).delete(delete_definition),
        )
        .route("/conversations/{id}/custom_attributes", post(conversation_attributes))
}
