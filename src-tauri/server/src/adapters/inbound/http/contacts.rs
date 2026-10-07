//! Contacts: list, detail, create, edit (incl. block and custom attributes), delete and merge.
use super::auth::CurrentUser;
use super::error::{created, done, ok, ApiResult};
use super::input::{check, email, id, int_param, nullable_text, optional_text, text, Body, Query};
use super::state::AppState;
use crate::domain::contacts::normalize_phone;
use crate::domain::model::{ContactChanges, NewContact};
use axum::extract::{Path, Query as Params, State};
use axum::response::Response;
use axum::routing::{get, post};
use axum::Router;
use serde::Deserialize;
use serde_json::{Map, Value};

async fn contacts(
    State(state): State<AppState>,
    current: CurrentUser,
    Params(query): Params<Query>,
) -> ApiResult<Response> {
    let q = text(query.get("q").map_or("", String::as_str), 0, 100)?;
    let page = int_param(&query, "page", 1, 1, 10_000)?;
    ok(state.support().helpdesk.contacts(&current.actor(), &q, page)?)
}

async fn contact(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(contact): Path<String>,
) -> ApiResult<Response> {
    ok(state.support().helpdesk.contact(&current.actor(), id(&contact)?)?)
}

fn phone(value: Option<&str>) -> ApiResult<Option<String>> {
    Ok(value
        .filter(|p| !p.trim().is_empty())
        .map(normalize_phone)
        .transpose()?)
}

#[derive(Deserialize)]
struct Create {
    name: Option<String>,
    phone_number: Option<String>,
    email: Option<String>,
    identifier: Option<String>,
}

async fn create(State(state): State<AppState>, current: CurrentUser, Body(body): Body<Create>) -> ApiResult<Response> {
    let new = NewContact {
        name: optional_text(body.name.as_deref(), 1, 120)?,
        phone_number: phone(body.phone_number.as_deref())?,
        email: body.email.as_deref().map(email).transpose()?,
        identifier: optional_text(body.identifier.as_deref(), 1, 120)?,
    };
    created(state.support().helpdesk.create_contact(&current.actor(), &new)?)
}

#[derive(Deserialize)]
struct ContactUpdate {
    #[serde(flatten)]
    changes: ContactChanges,
    custom_attributes: Option<Map<String, Value>>,
}

async fn update(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(contact): Path<String>,
    Body(update): Body<ContactUpdate>,
) -> ApiResult<Response> {
    let body = update.changes;
    let address = match body.email.clone() {
        Some(Some(value)) => Some(Some(email(&value)?)),
        other => other,
    };
    let number = match body.phone_number.clone() {
        Some(value) => Some(phone(value.as_deref())?),
        None => None,
    };
    let changes = ContactChanges {
        name: nullable_text(body.name.clone(), 120)?,
        email: address,
        identifier: nullable_text(body.identifier.clone(), 120)?,
        phone_number: number,
        blocked: None,
        last_activity_at: None,
    };
    let (helpdesk, actor, contact) = (&state.support().helpdesk, current.actor(), id(&contact)?);
    let mut updated = helpdesk.update_contact(&actor, contact, &changes)?;
    if let Some(blocked) = body.blocked {
        updated = helpdesk.set_blocked(&actor, contact, blocked).await?;
    }
    match update.custom_attributes {
        Some(attributes) => ok(helpdesk.set_contact_attributes(&actor, contact, &attributes)?),
        None => ok(updated),
    }
}

async fn remove(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(contact): Path<String>,
) -> ApiResult<Response> {
    state
        .support()
        .helpdesk
        .delete_contact(&current.actor(), id(&contact)?)?;
    done()
}

#[derive(Deserialize)]
struct Labels {
    labels: Vec<String>,
}

async fn labels(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(contact): Path<String>,
    Body(body): Body<Labels>,
) -> ApiResult<Response> {
    check(body.labels.len() <= 50 && body.labels.iter().all(|l| l.chars().count() <= 40))?;
    ok(state
        .support()
        .helpdesk
        .set_contact_labels(&current.actor(), id(&contact)?, &body.labels)?)
}

async fn avatar(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(contact): Path<String>,
) -> ApiResult<Response> {
    ok(state
        .support()
        .helpdesk
        .refresh_avatar(&current.actor(), id(&contact)?)
        .await?)
}

#[derive(Deserialize)]
struct Merge {
    base_contact_id: i64,
    mergee_contact_id: i64,
}

async fn merge(State(state): State<AppState>, current: CurrentUser, Body(body): Body<Merge>) -> ApiResult<Response> {
    check(body.base_contact_id > 0 && body.mergee_contact_id > 0)?;
    ok(state
        .support()
        .helpdesk
        .merge_contacts(&current.actor(), body.base_contact_id, body.mergee_contact_id)?)
}

#[derive(Deserialize)]
struct FirstMessage {
    content: Option<String>,
}

#[derive(Deserialize)]
struct NewConversation {
    contact_id: i64,
    inbox_id: i64,
    message: Option<FirstMessage>,
}

/// Chatwoot `POST /conversations`: start talking to a contact from an inbox.
async fn start(
    State(state): State<AppState>,
    current: CurrentUser,
    Body(body): Body<NewConversation>,
) -> ApiResult<Response> {
    check(body.contact_id > 0 && body.inbox_id > 0)?;
    let content = body.message.and_then(|m| m.content);
    check(content.as_ref().is_none_or(|c| c.chars().count() <= 4096))?;
    created(
        state
            .support()
            .helpdesk
            .start_conversation(&current.actor(), body.contact_id, body.inbox_id, content)
            .await?,
    )
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/contacts", get(contacts).post(create))
        .route("/contacts/{id}", get(contact).patch(update).delete(remove))
        .route("/contacts/{id}/labels", post(labels))
        .route("/contacts/{id}/avatar", post(avatar))
        .route("/actions/contact_merge", post(merge))
        .route("/conversations", post(start))
}
