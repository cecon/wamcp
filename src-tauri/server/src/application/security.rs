//! Account security: two-factor authentication (TOTP + backup codes), browser sessions and the
//! audit log of administrative changes.
use super::accounts::{AccountService, Login, SESSION_TTL_MS};
use super::crypto::{random_bytes, random_secret, sha256_hex};
use crate::domain::actor::Actor;
use crate::domain::error::{fail, fail_with, HelpdeskError, Result};
use crate::domain::helpdesk::require_admin;
use crate::domain::model::{AuditLog, MfaState, NewAuditLog, SessionInfo, User};
use crate::domain::totp::{base32_decode, base32_encode, otpauth_uri, verify};
use serde_json::{json, Value};

/// Login challenges expire after five minutes and allow five codes.
const CHALLENGE_TTL: i64 = 300;
const CHALLENGE_ATTEMPTS: i64 = 5;
const BACKUP_CODES: usize = 10;

/// Password accepted: either a session, or a two-factor challenge to complete with a code.
pub enum LoginOutcome {
    Session(Box<Login>),
    Mfa { token: String },
}

fn normalize_backup(code: &str) -> String {
    code.trim().to_lowercase().replace(['-', ' '], "")
}

impl AccountService {
    pub(super) fn start_session(&self, user_id: i64, user_agent: Option<&str>) -> Result<Login> {
        let session = self.core.repo.create_web_session(user_id, SESSION_TTL_MS, user_agent)?;
        self.audit(Some(user_id), "sign_in", "user", Some(user_id), json!({}), None)?;
        Ok(Login {
            cookie: session.cookie,
            csrf: session.csrf,
            user: self.find_user(user_id)?,
        })
    }

    pub(super) fn challenge(&self, user_id: i64) -> Result<LoginOutcome> {
        let token = random_secret();
        let expires = self.core.now() + CHALLENGE_TTL;
        self.core
            .repo
            .create_mfa_challenge(&sha256_hex(&token), user_id, expires)?;
        Ok(LoginOutcome::Mfa { token })
    }

    /// Accepts a current TOTP code (never the same step twice) or consumes a backup code.
    fn check_code(&self, user_id: i64, state: &MfaState, code: &str) -> Result<bool> {
        let secret = state.mfa_secret.as_deref().and_then(base32_decode).unwrap_or_default();
        if let Some(step) = verify(&secret, code, self.core.now(), state.mfa_last_step) {
            self.core.repo.set_mfa_step(user_id, step)?;
            return Ok(true);
        }
        let hash = sha256_hex(&normalize_backup(code));
        if !state.mfa_backup_codes.contains(&hash) {
            return Ok(false);
        }
        let remaining: Vec<String> = state.mfa_backup_codes.iter().filter(|c| **c != hash).cloned().collect();
        self.core.repo.set_backup_codes(user_id, &remaining)?;
        Ok(true)
    }

    /// Second login step: the challenge token from the first step plus a code.
    pub fn complete_mfa(&self, token: &str, code: &str, user_agent: Option<&str>) -> Result<Login> {
        let repo = &self.core.repo;
        let hash = sha256_hex(token);
        let Some(user_id) = repo.mfa_challenge(&hash, self.core.now(), CHALLENGE_ATTEMPTS)? else {
            return fail_with("Verificação expirada; entre novamente", 401);
        };
        let user = self.find_user(user_id)?;
        if !user.is_active() || !self.check_code(user_id, &repo.mfa_state(user_id)?, code)? {
            return fail_with("Código inválido", 401);
        }
        repo.delete_mfa_challenge(&hash)?;
        self.start_session(user_id, user_agent)
    }

    /// Starts enrolment: a new secret for the authenticator app (enabled only after `enable_mfa`).
    pub fn setup_mfa(&self, user: &User) -> Result<Value> {
        if self.core.repo.mfa_state(user.id)?.mfa_enabled != 0 {
            return fail_with("A verificação em duas etapas já está ativa", 422);
        }
        let secret = base32_encode(&random_bytes(20));
        self.core.repo.set_mfa(user.id, Some(&secret), false, &[])?;
        Ok(json!({ "secret": secret, "otpauth_uri": otpauth_uri("wamcp", &user.email, &secret) }))
    }

    /// Confirms enrolment with a code and returns the one-time backup codes (shown only once).
    pub fn enable_mfa(&self, user: &User, code: &str) -> Result<Value> {
        let state = self.core.repo.mfa_state(user.id)?;
        if state.mfa_enabled != 0 || state.mfa_secret.is_none() {
            return fail_with("Inicie a configuração da verificação em duas etapas", 422);
        }
        if !self.check_code(user.id, &state, code)? {
            return fail_with("Código inválido", 422);
        }
        let codes: Vec<String> = (0..BACKUP_CODES)
            .map(|_| {
                let raw = hex::encode(random_bytes(5));
                format!("{}-{}", &raw[..5], &raw[5..])
            })
            .collect();
        let hashes: Vec<String> = codes.iter().map(|c| sha256_hex(&normalize_backup(c))).collect();
        self.core
            .repo
            .set_mfa(user.id, state.mfa_secret.as_deref(), true, &hashes)?;
        self.audit(Some(user.id), "enable_mfa", "user", Some(user.id), json!({}), None)?;
        Ok(json!({ "backup_codes": codes }))
    }

    /// Turning two-factor off needs the password and a current code.
    pub async fn disable_mfa(&self, user: &User, password: &str, code: &str) -> Result<()> {
        let stored = self.core.repo.password_hash(user.id)?.unwrap_or_default();
        let state = self.core.repo.mfa_state(user.id)?;
        if !self.hasher.verify(password, &stored).await || state.mfa_enabled == 0 {
            return fail_with("Senha incorreta", 422);
        }
        if !self.check_code(user.id, &state, code)? {
            return fail_with("Código inválido", 422);
        }
        self.core.repo.set_mfa(user.id, None, false, &[])?;
        self.audit(Some(user.id), "disable_mfa", "user", Some(user.id), json!({}), None)
    }

    /// Administrators can reset an agent who lost the authenticator.
    pub fn reset_mfa(&self, actor: &Actor, id: i64) -> Result<()> {
        require_admin(actor)?;
        self.find_user(id)?;
        self.core.repo.set_mfa(id, None, false, &[])
    }

    pub fn sessions(&self, user: &User, cookie: Option<&str>) -> Result<Vec<SessionInfo>> {
        let current = cookie.map(sha256_hex);
        let mut sessions = self.core.repo.user_sessions(user.id)?;
        for session in &mut sessions {
            session.current = current.as_deref() == Some(session.id.as_str());
        }
        Ok(sessions)
    }

    pub fn revoke_session(&self, user: &User, id: &str) -> Result<()> {
        if self.core.repo.delete_session(user.id, id)? == 0 {
            return Err(HelpdeskError::not_found("Sessão não encontrada").into());
        }
        Ok(())
    }

    /// Signs out every other browser, keeping the current one.
    pub fn revoke_other_sessions(&self, user: &User, cookie: &str) -> Result<()> {
        self.core.repo.delete_other_sessions(user.id, &sha256_hex(cookie))
    }

    pub fn audit(
        &self,
        user_id: Option<i64>,
        action: &str,
        auditable_type: &str,
        auditable_id: Option<i64>,
        details: Value,
        ip_address: Option<String>,
    ) -> Result<()> {
        self.core.repo.add_audit_log(&NewAuditLog {
            user_id,
            action: action.into(),
            auditable_type: auditable_type.into(),
            auditable_id,
            details,
            ip_address,
            created_at: self.core.now(),
        })
    }

    pub fn audit_logs(&self, actor: &Actor, page: i64) -> Result<Vec<AuditLog>> {
        require_admin(actor)?;
        if page < 1 {
            return fail("Página inválida");
        }
        self.core.repo.audit_logs(page, 50)
    }
}
