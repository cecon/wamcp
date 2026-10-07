use crate::domain::error::Result;
use crate::domain::model::{
    Account, AuditLog, Contact, ContactChannel, ContactNote, Credentials, MfaState, NewAuditLog, SessionInfo, Team,
    TeamFields, TokenOwner, User, UserChanges, WebSession,
};
use serde_json::Value;

/// Users, web sessions, API tokens, teams and inbox membership.
pub trait UsersRepo {
    fn count_users(&self) -> Result<i64>;
    fn user(&self, id: i64) -> Result<Option<User>>;
    fn users(&self) -> Result<Vec<User>>;
    fn credentials(&self, email: &str) -> Result<Option<Credentials>>;
    fn password_hash(&self, id: i64) -> Result<Option<String>>;
    fn create_user(&self, name: &str, email: &str, role: &str, password_hash: &str) -> Result<User>;
    fn email_taken(&self, email: &str, except_id: i64) -> Result<bool>;
    fn update_user(&self, id: i64, changes: &UserChanges) -> Result<User>;
    fn delete_user(&self, id: i64) -> Result<()>;
    fn count_admins(&self) -> Result<i64>;

    fn create_web_session(&self, user_id: i64, ttl_ms: i64, user_agent: Option<&str>) -> Result<WebSession>;
    /// The session's user id and CSRF token, when the cookie is valid and unexpired.
    fn web_session(&self, cookie: &str) -> Result<Option<(i64, String)>>;
    fn delete_web_session(&self, cookie: &str) -> Result<()>;
    fn delete_user_sessions(&self, user_id: i64) -> Result<()>;

    fn issue_api_token(&self, owner_type: &str, owner_id: i64) -> Result<String>;
    fn api_token_owner(&self, token: &str) -> Result<Option<TokenOwner>>;
}

/// Teams, inbox membership and the round-robin assignment cursor.
pub trait TeamsRepo {
    fn teams(&self) -> Result<Vec<Team>>;
    fn team(&self, id: i64) -> Result<Option<Team>>;
    fn team_by_name(&self, name: &str, except_id: i64) -> Result<Option<Team>>;
    fn create_team(&self, fields: &TeamFields) -> Result<Team>;
    fn update_team(&self, id: i64, fields: &TeamFields) -> Result<Team>;
    fn delete_team(&self, id: i64) -> Result<()>;
    fn team_members(&self, team_id: i64) -> Result<Vec<User>>;
    fn add_team_members(&self, team_id: i64, user_ids: &[i64]) -> Result<()>;
    fn remove_team_members(&self, team_id: i64, user_ids: &[i64]) -> Result<()>;

    fn member_inbox_ids(&self, user_id: i64) -> Result<Vec<i64>>;
    fn inbox_members(&self, inbox_id: i64) -> Result<Vec<User>>;
    fn add_inbox_members(&self, inbox_id: i64, user_ids: &[i64]) -> Result<()>;
    fn remove_inbox_members(&self, inbox_id: i64, user_ids: &[i64]) -> Result<()>;
    /// Online, active members of the inbox (optionally restricted to a team) eligible for assignment.
    /// Online active members (of the team, when given) below the open-conversation limit.
    fn assignable_ids(&self, inbox_id: i64, team_id: Option<i64>, limit: Option<i64>) -> Result<Vec<i64>>;
    fn assignment_cursor(&self, inbox_id: i64) -> Result<Option<i64>>;
    fn set_assignment_cursor(&self, inbox_id: i64, user_id: i64) -> Result<()>;
}

/// Contact book: notes, labels, channels, deletion, merging and export.
pub trait ContactBookRepo {
    fn contact_notes(&self, contact_id: i64) -> Result<Vec<ContactNote>>;
    fn contact_note(&self, id: i64) -> Result<Option<ContactNote>>;
    fn create_contact_note(&self, contact_id: i64, user_id: Option<i64>, content: &str, at: i64)
        -> Result<ContactNote>;
    fn delete_contact_note(&self, id: i64) -> Result<()>;
    fn set_contact_labels(&self, contact_id: i64, label_ids: &[i64]) -> Result<()>;
    fn set_contact_avatar(&self, contact_id: i64, url: Option<&str>) -> Result<()>;
    fn contact_channels(&self, contact_id: i64) -> Result<Vec<ContactChannel>>;
    fn delete_contact(&self, id: i64) -> Result<()>;
    /// Moves channels, conversations, labels, notes and CSAT answers to `base`, then deletes `mergee`.
    fn merge_contacts(&self, base: i64, mergee: i64) -> Result<()>;
    /// Contacts ordered by id, after `after_id` (for exports).
    fn contacts_after(&self, after_id: i64, limit: i64) -> Result<Vec<Contact>>;
}

/// Two-factor authentication, browser sessions and the audit log.
pub trait SecurityRepo {
    fn mfa_state(&self, user_id: i64) -> Result<MfaState>;
    /// Replaces the secret, the enabled flag and the backup codes (a new secret resets the last step).
    fn set_mfa(&self, user_id: i64, secret: Option<&str>, enabled: bool, backup_codes: &[String]) -> Result<()>;
    fn set_mfa_step(&self, user_id: i64, step: i64) -> Result<()>;
    fn set_backup_codes(&self, user_id: i64, backup_codes: &[String]) -> Result<()>;
    /// Stores a login challenge under the hash of its token.
    fn create_mfa_challenge(&self, token_hash: &str, user_id: i64, expires_at: i64) -> Result<()>;
    /// The challenge's user while unexpired and under the attempt limit; counts the attempt.
    fn mfa_challenge(&self, token_hash: &str, now: i64, max_attempts: i64) -> Result<Option<i64>>;
    fn delete_mfa_challenge(&self, token_hash: &str) -> Result<()>;

    fn user_sessions(&self, user_id: i64) -> Result<Vec<SessionInfo>>;
    fn delete_session(&self, user_id: i64, session_id: &str) -> Result<usize>;
    fn delete_other_sessions(&self, user_id: i64, keep_id: &str) -> Result<()>;

    fn add_audit_log(&self, entry: &NewAuditLog) -> Result<()>;
    fn audit_logs(&self, page: i64, per_page: i64) -> Result<Vec<AuditLog>>;
}

/// The account (company) settings and account-wide sweeps.
pub trait AccountRepo {
    fn account(&self) -> Result<Account>;
    fn update_account(&self, name: Option<&str>, locale: Option<&str>, settings: Option<&Value>) -> Result<Account>;
    /// Open or pending conversations with no activity since `before`.
    fn inactive_conversations(&self, before: i64) -> Result<Vec<i64>>;
}
