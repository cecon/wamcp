//! Records successful administrative changes in the audit log.
use super::auth::CurrentUser;
use super::rate_limit::{client_key, Peer};
use super::state::AppState;
use crate::domain::audit::audit_entry;
use axum::extract::{FromRequestParts, Request, State};
use axum::middleware::Next;
use axum::response::Response;
use serde_json::json;

pub async fn record(State(state): State<AppState>, request: Request, next: Next) -> Response {
    let method = request.method().clone();
    let path = request.uri().path().trim_start_matches("/api/v1").to_string();
    let Some(entry) = audit_entry(method.as_str(), &path) else {
        return next.run(request).await;
    };
    let (mut parts, body) = request.into_parts();
    let user = CurrentUser::from_request_parts(&mut parts, &state).await.ok();
    let peer = Peer::from_request_parts(&mut parts, &state)
        .await
        .ok()
        .and_then(|p| p.0);
    let ip = Some(client_key(&parts.headers, peer)).filter(|ip| !ip.is_empty());
    let response = next.run(Request::from_parts(parts, body)).await;
    if response.status().is_success() {
        let details = json!({ "method": method.as_str(), "path": path });
        let user_id = user.map(|u| u.user.id);
        if let Err(error) = state.support().accounts.audit(
            user_id,
            &entry.action,
            &entry.auditable_type,
            entry.auditable_id,
            details,
            ip,
        ) {
            tracing::warn!(%error, "falha ao registrar auditoria");
        }
    }
    response
}
