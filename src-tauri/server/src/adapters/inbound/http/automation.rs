//! Webhooks, automation rules, reports and CSAT under /api/v1 (administrators only).
use super::auth::CurrentUser;
use super::error::{created, done, ok, ApiResult};
use super::input::{check, id, optional_id, text, Body, Query};
use super::state::AppState;
use crate::application::ports::NewRule;
use crate::application::reports::PeriodQuery;
use crate::domain::automation::{is_condition_attribute, ACTIONS, AUTOMATION_EVENTS, OPERATORS};
use crate::domain::model::{Action, Condition, RuleFields, WebhookFields};
use crate::domain::webhooks::is_webhook_event;
use axum::extract::{Path, Query as Params, State};
use axum::response::Response;
use axum::routing::{get, patch, post};
use axum::Router;
use serde_json::Value;

fn webhook_fields(body: WebhookFields, partial: bool) -> ApiResult<WebhookFields> {
    check(partial || (body.url.is_some() && body.subscriptions.is_some()))?;
    check(
        body.subscriptions
            .as_ref()
            .is_none_or(|s| !s.is_empty() && s.iter().all(|e| is_webhook_event(e))),
    )?;
    check(body.inbox_id.flatten().is_none_or(|i| i > 0))?;
    Ok(WebhookFields {
        url: body.url.as_deref().map(|u| text(u, 0, 2000)).transpose()?,
        ..body
    })
}

async fn webhooks(State(state): State<AppState>, current: CurrentUser) -> ApiResult<Response> {
    ok(state.support().webhooks.list(&current.actor())?)
}

async fn create_webhook(
    State(state): State<AppState>,
    current: CurrentUser,
    Body(body): Body<WebhookFields>,
) -> ApiResult<Response> {
    let fields = webhook_fields(body, false)?;
    let (url, subscriptions) = (fields.url.unwrap_or_default(), fields.subscriptions.unwrap_or_default());
    let inbox = fields.inbox_id.flatten();
    created(
        state
            .support()
            .webhooks
            .create(&current.actor(), &url, &subscriptions, inbox)?,
    )
}

async fn update_webhook(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(webhook): Path<String>,
    Body(body): Body<WebhookFields>,
) -> ApiResult<Response> {
    let id = id(&webhook)?;
    ok(state
        .support()
        .webhooks
        .update(&current.actor(), id, &webhook_fields(body, true)?)?)
}

async fn delete_webhook(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(webhook): Path<String>,
) -> ApiResult<Response> {
    state.support().webhooks.remove(&current.actor(), id(&webhook)?)?;
    done()
}

async fn deliveries(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(webhook): Path<String>,
) -> ApiResult<Response> {
    ok(state.support().webhooks.deliveries(&current.actor(), id(&webhook)?)?)
}

fn scalars(values: &[Value]) -> bool {
    values.len() <= 20
        && values.iter().all(|v| match v {
            Value::String(s) => s.chars().count() <= 4096,
            Value::Number(_) => true,
            _ => false,
        })
}

fn valid_conditions(conditions: &[Condition]) -> bool {
    conditions.len() <= 20
        && conditions.iter().all(|c| {
            is_condition_attribute(&c.attribute_key)
                && OPERATORS.contains(&c.filter_operator.as_str())
                && (c.query_operator == "and" || c.query_operator == "or")
                && scalars(&c.values)
        })
}

pub(super) fn valid_actions(actions: &[Action]) -> bool {
    (1..=20).contains(&actions.len())
        && actions
            .iter()
            .all(|a| ACTIONS.contains(&a.action_name.as_str()) && scalars(&a.action_params))
}

fn rule_fields(body: RuleFields, partial: bool) -> ApiResult<RuleFields> {
    check(
        partial
            || (body.name.is_some()
                && body.event_name.is_some()
                && body.conditions.is_some()
                && body.actions.is_some()),
    )?;
    check(
        body.event_name
            .as_deref()
            .is_none_or(|e| AUTOMATION_EVENTS.contains(&e)),
    )?;
    check(body.conditions.as_deref().is_none_or(valid_conditions))?;
    check(body.actions.as_deref().is_none_or(valid_actions))?;
    Ok(RuleFields {
        name: body.name.as_deref().map(|n| text(n, 1, 120)).transpose()?,
        description: super::input::nullable_text(body.description, 500)?,
        ..body
    })
}

async fn rules(State(state): State<AppState>, current: CurrentUser) -> ApiResult<Response> {
    ok(state.support().automations.list(&current.actor())?)
}

async fn create_rule(
    State(state): State<AppState>,
    current: CurrentUser,
    Body(body): Body<RuleFields>,
) -> ApiResult<Response> {
    let fields = rule_fields(body, false)?;
    let rule = NewRule {
        name: fields.name.unwrap_or_default(),
        description: fields.description.flatten(),
        event_name: fields.event_name.unwrap_or_default(),
        conditions: fields.conditions.unwrap_or_default(),
        actions: fields.actions.unwrap_or_default(),
        active: fields.active.unwrap_or(true),
    };
    created(state.support().automations.create(&current.actor(), &rule)?)
}

async fn update_rule(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(rule): Path<String>,
    Body(body): Body<RuleFields>,
) -> ApiResult<Response> {
    let id = id(&rule)?;
    ok(state
        .support()
        .automations
        .update(&current.actor(), id, &rule_fields(body, true)?)?)
}

async fn delete_rule(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(rule): Path<String>,
) -> ApiResult<Response> {
    state.support().automations.remove(&current.actor(), id(&rule)?)?;
    done()
}

async fn clone_rule(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(rule): Path<String>,
) -> ApiResult<Response> {
    created(state.support().automations.clone_rule(&current.actor(), id(&rule)?)?)
}

fn period(query: &Query) -> ApiResult<PeriodQuery> {
    Ok(PeriodQuery {
        since: optional_id(query, "since")?,
        until: optional_id(query, "until")?,
        inbox_id: optional_id(query, "inbox_id")?,
    })
}

async fn summary(
    State(state): State<AppState>,
    current: CurrentUser,
    Params(query): Params<Query>,
) -> ApiResult<Response> {
    ok(state.support().reports.summary(&current.actor(), period(&query)?)?)
}

async fn agent_report(
    State(state): State<AppState>,
    current: CurrentUser,
    Params(query): Params<Query>,
) -> ApiResult<Response> {
    ok(state.support().reports.agents(&current.actor(), period(&query)?)?)
}

async fn csat(
    State(state): State<AppState>,
    current: CurrentUser,
    Params(query): Params<Query>,
) -> ApiResult<Response> {
    ok(state.support().reports.csat(&current.actor(), period(&query)?)?)
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/webhooks", get(webhooks).post(create_webhook))
        .route("/webhooks/{id}", patch(update_webhook).delete(delete_webhook))
        .route("/webhooks/{id}/deliveries", get(deliveries))
        .route("/automation_rules", get(rules).post(create_rule))
        .route("/automation_rules/{id}", patch(update_rule).delete(delete_rule))
        .route("/automation_rules/{id}/clone", post(clone_rule))
        .route("/reports/summary", get(summary))
        .route("/reports/agents", get(agent_report))
        .route("/csat_responses", get(csat))
}
