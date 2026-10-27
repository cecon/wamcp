//! Agent roster (administrators): human and AI agents, skills (with `SKILL.md` import) and credentials.
use super::auth::CurrentUser;
use super::error::{created, done, ok, ApiResult};
use super::input::{id, nullable_text, text, Body};
use super::state::AppState;
use crate::domain::agents::whatsapp_jid;
use crate::domain::error::HelpdeskError;
use crate::domain::model::{RosterAgentDraft, Skill};
use axum::extract::{Path, State};
use axum::response::Response;
use axum::routing::{delete, get, post, put};
use axum::Router;
use serde::Deserialize;

#[derive(Deserialize)]
struct AgentBody {
    name: Option<String>,
    kind: Option<String>,
    profile_id: Option<i64>,
    description: Option<String>,
    user_id: Option<i64>,
    whatsapp: Option<String>,
    runtime: Option<String>,
    model: Option<String>,
    instructions: Option<String>,
    active: Option<bool>,
}

fn optional(value: Option<String>, max: usize) -> ApiResult<Option<String>> {
    Ok(nullable_text(Some(value), max)?.flatten().filter(|v| !v.is_empty()))
}

fn draft(id: i64, body: AgentBody) -> ApiResult<RosterAgentDraft> {
    let whatsapp = match body.whatsapp.as_deref().map(str::trim).filter(|w| !w.is_empty()) {
        Some(number) => match whatsapp_jid(number) {
            Some(jid) => Some(jid),
            None => return Err(HelpdeskError::new("WhatsApp inválido: use DDI + DDD + número").into()),
        },
        None => None,
    };
    Ok(RosterAgentDraft {
        id,
        name: text(body.name.as_deref().unwrap_or_default(), 1, 80)?,
        kind: body.kind.unwrap_or_default(),
        role: String::new(),
        profile_id: body.profile_id,
        description: optional(body.description, 500)?,
        user_id: body.user_id,
        whatsapp_jid: whatsapp,
        runtime: optional(body.runtime, 40)?,
        model: optional(body.model, 80)?,
        instructions: optional(body.instructions, 8000)?,
        active: body.active.unwrap_or(true),
    })
}

async fn agents(State(state): State<AppState>, current: CurrentUser) -> ApiResult<Response> {
    ok(state.support().agents.agents(&current.actor())?)
}

async fn create_agent(
    State(state): State<AppState>,
    current: CurrentUser,
    Body(body): Body<AgentBody>,
) -> ApiResult<Response> {
    created(state.support().agents.save_agent(&current.actor(), &draft(0, body)?)?)
}

/// Replaces the agent (every field; the kind must stay the same).
async fn update_agent(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(agent): Path<String>,
    Body(body): Body<AgentBody>,
) -> ApiResult<Response> {
    let draft = draft(id(&agent)?, body)?;
    ok(state.support().agents.save_agent(&current.actor(), &draft)?)
}

async fn delete_agent(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(agent): Path<String>,
) -> ApiResult<Response> {
    state.support().agents.delete_agent(&current.actor(), id(&agent)?)?;
    done()
}

#[derive(Deserialize)]
struct SkillIds {
    skill_ids: Vec<i64>,
}

async fn set_skills(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(agent): Path<String>,
    Body(body): Body<SkillIds>,
) -> ApiResult<Response> {
    ok(state
        .support()
        .agents
        .set_agent_skills(&current.actor(), id(&agent)?, &body.skill_ids)?)
}

#[derive(Deserialize)]
struct SkillBody {
    name: Option<String>,
    description: Option<String>,
    #[serde(default)]
    instructions: String,
    #[serde(default)]
    tools: Vec<String>,
}

fn skill(id: i64, body: SkillBody) -> ApiResult<Skill> {
    Ok(Skill {
        id,
        name: text(body.name.as_deref().unwrap_or_default(), 1, 80)?,
        description: optional(body.description, 500)?,
        instructions: body.instructions.chars().take(20000).collect(),
        tools: body
            .tools
            .into_iter()
            .map(|t| t.trim().to_string())
            .filter(|t| !t.is_empty())
            .collect(),
        created: String::new(),
    })
}

async fn skills(State(state): State<AppState>, current: CurrentUser) -> ApiResult<Response> {
    ok(state.support().agents.skills(&current.actor())?)
}

async fn create_skill(
    State(state): State<AppState>,
    current: CurrentUser,
    Body(body): Body<SkillBody>,
) -> ApiResult<Response> {
    created(state.support().agents.save_skill(&current.actor(), &skill(0, body)?)?)
}

async fn update_skill(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(s): Path<String>,
    Body(body): Body<SkillBody>,
) -> ApiResult<Response> {
    let skill = skill(id(&s)?, body)?;
    ok(state.support().agents.save_skill(&current.actor(), &skill)?)
}

async fn delete_skill(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(s): Path<String>,
) -> ApiResult<Response> {
    state.support().agents.delete_skill(&current.actor(), id(&s)?)?;
    done()
}

#[derive(Deserialize)]
struct Import {
    content: String,
}

/// Creates a skill from the text of a `SKILL.md` (front matter + instructions).
async fn import_skill(
    State(state): State<AppState>,
    current: CurrentUser,
    Body(body): Body<Import>,
) -> ApiResult<Response> {
    created(state.support().agents.import_skill(&current.actor(), &body.content)?)
}

#[derive(Deserialize)]
struct CredentialBody {
    name: String,
    kind: String,
    secret: String,
}

async fn credentials(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(agent): Path<String>,
) -> ApiResult<Response> {
    ok(state
        .support()
        .agents
        .agent_credentials(&current.actor(), id(&agent)?)?)
}

async fn add_credential(
    State(state): State<AppState>,
    current: CurrentUser,
    Path(agent): Path<String>,
    Body(body): Body<CredentialBody>,
) -> ApiResult<Response> {
    created(state.support().agents.add_agent_credential(
        &current.actor(),
        id(&agent)?,
        body.name.trim(),
        &body.kind,
        &body.secret,
    )?)
}

async fn delete_credential(
    State(state): State<AppState>,
    current: CurrentUser,
    Path((agent, credential)): Path<(String, String)>,
) -> ApiResult<Response> {
    state
        .support()
        .agents
        .delete_agent_credential(&current.actor(), id(&agent)?, id(&credential)?)?;
    done()
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/agent_directory", get(agents).post(create_agent))
        .route(
            "/agent_directory/{id}",
            put(update_agent).patch(update_agent).delete(delete_agent),
        )
        .route("/agent_directory/{id}/skills", put(set_skills))
        .route(
            "/agent_directory/{id}/credentials",
            get(credentials).post(add_credential),
        )
        .route(
            "/agent_directory/{id}/credentials/{credential}",
            delete(delete_credential),
        )
        .route("/skills", get(skills).post(create_skill))
        .route("/skills/import", post(import_skill))
        .route(
            "/skills/{id}",
            put(update_skill).patch(update_skill).delete(delete_skill),
        )
}
