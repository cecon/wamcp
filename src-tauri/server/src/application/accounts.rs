//! Agents, authentication and profile (Chatwoot's users, sessions and access tokens).
use super::core::Core;
use super::ports::PasswordHasher;
use super::security::LoginOutcome;
use crate::domain::actor::Actor;
use crate::domain::error::{fail_with, HelpdeskError, Result};
use crate::domain::helpdesk::{require_admin, validate_password};
use crate::domain::model::{Agent, User, UserChanges};
use serde_json::json;
use std::sync::Arc;

pub const SESSION_TTL_MS: i64 = 7 * 86_400_000;
/// Hashed when the e-mail is unknown, so response time does not reveal which e-mails exist.
const DUMMY_HASH: &str = "scrypt$AAAAAAAAAAAAAAAAAAAAAA$AAAA";

pub fn normalize_email(email: &str) -> String {
    email.trim().to_lowercase()
}

#[derive(Clone)]
pub struct AccountService {
    pub core: Core,
    pub hasher: Arc<dyn PasswordHasher>,
}

/// A successful login: the browser session plus the user.
pub struct Login {
    pub cookie: String,
    pub csrf: String,
    pub user: User,
}

pub struct NewAgent {
    pub name: String,
    pub email: String,
    pub role: String,
    pub password: String,
    pub inbox_ids: Vec<i64>,
}

#[derive(Default)]
pub struct ProfileChanges {
    pub name: Option<String>,
    pub display_name: Option<Option<String>>,
    pub availability: Option<String>,
    pub current_password: Option<String>,
    pub password: Option<String>,
}

#[derive(Default)]
pub struct AgentChanges {
    pub name: Option<String>,
    pub display_name: Option<Option<String>>,
    pub role: Option<String>,
    pub active: Option<bool>,
    pub password: Option<String>,
}

impl AccountService {
    pub(crate) fn find_user(&self, id: i64) -> Result<User> {
        self.core
            .repo
            .user(id)?
            .ok_or_else(|| HelpdeskError::not_found("Agente não encontrado").into())
    }

    pub fn needs_bootstrap(&self) -> Result<bool> {
        Ok(self.core.repo.count_users()? == 0)
    }

    /// The desktop owner creates the first administrator; afterwards the endpoint is closed.
    pub async fn bootstrap(&self, name: &str, email: &str, password: &str) -> Result<User> {
        let repo = &self.core.repo;
        if repo.count_users()? > 0 {
            return fail_with("O administrador já foi criado", 409);
        }
        validate_password(password)?;
        let hash = self.hasher.hash(password).await?;
        let admin = repo.create_user(name, &normalize_email(email), "administrator", &hash)?;
        repo.sync_inboxes()?;
        for inbox in repo.inboxes(None)? {
            repo.add_inbox_members(inbox.id, &[admin.id])?;
        }
        Ok(admin)
    }

    /// Checks the password; agents with two-factor on get a challenge instead of a session.
    pub async fn login(&self, email: &str, password: &str, user_agent: Option<&str>) -> Result<LoginOutcome> {
        let repo = &self.core.repo;
        let credentials = repo.credentials(&normalize_email(email))?;
        let stored = credentials.as_ref().map_or(DUMMY_HASH, |c| c.password_hash.as_str());
        let valid = self.hasher.verify(password, stored).await;
        let Some(credentials) = credentials.filter(|c| valid && c.active) else {
            return fail_with("E-mail ou senha inválidos", 401);
        };
        if repo.mfa_state(credentials.id)?.mfa_enabled != 0 {
            return self.challenge(credentials.id);
        }
        self.start_session(credentials.id, user_agent)
            .map(|login| LoginOutcome::Session(Box::new(login)))
    }

    pub fn logout(&self, cookie: &str) -> Result<()> {
        self.core.repo.delete_web_session(cookie)
    }

    /// Resolves a browser session cookie into the active user plus its CSRF token.
    pub fn authenticate_cookie(&self, cookie: &str) -> Result<Option<(User, String)>> {
        let Some((user_id, csrf)) = self.core.repo.web_session(cookie)? else {
            return Ok(None);
        };
        Ok(self.core.repo.user(user_id)?.filter(User::is_active).map(|u| (u, csrf)))
    }

    pub fn authenticate_api_token(&self, token: &str) -> Result<Option<User>> {
        let owner = self.core.repo.api_token_owner(token)?;
        match owner.filter(|o| o.owner_type == "user") {
            Some(owner) => Ok(self.core.repo.user(owner.owner_id)?.filter(User::is_active)),
            None => Ok(None),
        }
    }

    pub fn is_active(&self, user_id: i64) -> bool {
        matches!(self.core.repo.user(user_id), Ok(Some(user)) if user.is_active())
    }

    pub fn me(&self, user: &User) -> Result<Agent> {
        Ok(Agent {
            user: user.clone(),
            inbox_ids: self.core.repo.member_inbox_ids(user.id)?,
        })
    }

    pub fn issue_api_token(&self, user: &User) -> Result<serde_json::Value> {
        Ok(json!({ "token": self.core.repo.issue_api_token("user", user.id)? }))
    }

    pub async fn update_profile(&self, user: &User, changes: ProfileChanges) -> Result<User> {
        let repo = &self.core.repo;
        let mut fields = UserChanges {
            name: changes.name,
            display_name: changes.display_name,
            availability: changes.availability.clone(),
            ..Default::default()
        };
        if let Some(password) = changes.password {
            validate_password(&password)?;
            let stored = repo.password_hash(user.id)?.unwrap_or_default();
            if !self
                .hasher
                .verify(changes.current_password.as_deref().unwrap_or(""), &stored)
                .await
            {
                return fail_with("Senha atual incorreta", 403);
            }
            fields.password_hash = Some(self.hasher.hash(&password).await?);
        }
        let updated = repo.update_user(user.id, &fields)?;
        if let Some(availability) = changes.availability.filter(|a| *a != user.availability) {
            let presence = json!({ "user_id": user.id, "availability": availability });
            self.core.emit("presence.update", &presence, None);
        }
        Ok(updated)
    }

    pub fn agents(&self) -> Result<Vec<Agent>> {
        self.core.repo.users()?.iter().map(|u| self.me(u)).collect()
    }

    pub async fn create_agent(&self, actor: &Actor, agent: NewAgent) -> Result<User> {
        require_admin(actor)?;
        validate_password(&agent.password)?;
        let repo = &self.core.repo;
        let email = normalize_email(&agent.email);
        if repo.email_taken(&email, 0)? {
            return fail_with("E-mail já cadastrado", 409);
        }
        for id in &agent.inbox_ids {
            self.core.inbox(*id)?;
        }
        let hash = self.hasher.hash(&agent.password).await?;
        let created = repo.create_user(&agent.name, &email, &agent.role, &hash)?;
        for inbox_id in &agent.inbox_ids {
            repo.add_inbox_members(*inbox_id, &[created.id])?;
        }
        Ok(created)
    }

    pub async fn update_agent(&self, actor: &Actor, id: i64, changes: AgentChanges) -> Result<User> {
        require_admin(actor)?;
        let repo = &self.core.repo;
        let agent = self.find_user(id)?;
        let demoting = changes.role.as_deref().is_some_and(|r| r != "administrator") || changes.active == Some(false);
        if agent.role == "administrator" && demoting && repo.count_admins()? <= 1 {
            return fail_with("É preciso manter ao menos um administrador ativo", 409);
        }
        let mut fields = UserChanges {
            name: changes.name,
            display_name: changes.display_name,
            role: changes.role,
            active: changes.active,
            ..Default::default()
        };
        let reset = changes.password.is_some();
        if let Some(password) = changes.password {
            validate_password(&password)?;
            fields.password_hash = Some(self.hasher.hash(&password).await?);
        }
        let updated = repo.update_user(id, &fields)?;
        if changes.active == Some(false) || reset {
            repo.delete_user_sessions(id)?;
        }
        Ok(updated)
    }

    pub fn delete_agent(&self, actor: &Actor, id: i64) -> Result<()> {
        require_admin(actor)?;
        let agent = self.find_user(id)?;
        if actor.user_id() == Some(agent.id) {
            return fail_with("Você não pode excluir a própria conta", 409);
        }
        if agent.role == "administrator" && self.core.repo.count_admins()? <= 1 {
            return fail_with("É preciso manter ao menos um administrador ativo", 409);
        }
        self.core.repo.delete_user(id)
    }
}
