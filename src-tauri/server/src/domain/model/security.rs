use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Two-factor state of a user (never serialized to clients).
#[derive(Debug, Clone, Default, PartialEq, Deserialize)]
pub struct MfaState {
    pub mfa_secret: Option<String>,
    pub mfa_enabled: i64,
    pub mfa_last_step: Option<i64>,
    /// SHA-256 hashes of the unused backup codes.
    pub mfa_backup_codes: Vec<String>,
}

/// A browser session of the agent (`id` is the hash of the cookie, never the cookie).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SessionInfo {
    pub id: String,
    pub created: String,
    pub expires: String,
    pub last_seen: Option<String>,
    pub user_agent: Option<String>,
    #[serde(default)]
    pub current: bool,
}

/// One recorded administrative change.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AuditLog {
    pub id: i64,
    pub user_id: Option<i64>,
    pub user_name: Option<String>,
    pub action: String,
    pub auditable_type: String,
    pub auditable_id: Option<i64>,
    pub details: Value,
    pub ip_address: Option<String>,
    pub created_at: i64,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct NewAuditLog {
    pub user_id: Option<i64>,
    pub action: String,
    pub auditable_type: String,
    pub auditable_id: Option<i64>,
    pub details: Value,
    pub ip_address: Option<String>,
    pub created_at: i64,
}
