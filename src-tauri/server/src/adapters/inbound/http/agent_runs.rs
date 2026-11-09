//! What the AI agents are doing now ("Em execução"): answers, chat turns, scheduled runs and engine
//! activities the person may see. Changes arrive on the events stream as `agent_run.updated` and
//! `agent_run.finished`.
use super::auth::CurrentUser;
use super::error::{ok, ApiResult};
use super::state::AppState;
use crate::application::agent_runs::runs_for;
use axum::extract::State;
use axum::response::Response;
use axum::routing::get;
use axum::Router;

async fn runs(State(state): State<AppState>, current: CurrentUser) -> ApiResult<Response> {
    let support = state.support();
    ok(runs_for(
        &support.helpdesk.core,
        support.engine.get(),
        &current.actor(),
    )?)
}

pub fn routes() -> Router<AppState> {
    Router::new().route("/agent_runs", get(runs))
}
