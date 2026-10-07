//! Session access and media limits for MCP credentials.
use super::error::{fail_with, Result};
use super::model::Credential;

pub const MAX_MEDIA_BYTES: usize = 10 * 1024 * 1024;
pub const MEDIA_TOO_LARGE: &str = "O anexo excede o limite de 10 MiB por consulta.";

pub fn require_send_permission(credential: &Credential, session_id: &str) -> Result<()> {
    if credential.session_id == session_id && credential.can_send() {
        Ok(())
    } else {
        fail_with("Credencial sem permissão de envio nesta sessão", 403)
    }
}

pub fn require_session_credential(credential: &Credential, session_id: &str) -> Result<()> {
    if credential.session_id == session_id {
        Ok(())
    } else {
        fail_with("Sessão não autorizada", 403)
    }
}

pub fn media_too_large(size: Option<i64>) -> bool {
    size.is_some_and(|s| s > MAX_MEDIA_BYTES as i64)
}
