use crate::domain::error::Result;
use crate::domain::model::{Credentials, Team, TeamFields, TokenOwner, User, UserChanges, WebSession};

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
    fn assignable_ids(&self, inbox_id: i64, team_id: Option<i64>) -> Result<Vec<i64>>;
    fn assignment_cursor(&self, inbox_id: i64) -> Result<Option<i64>>;
    fn set_assignment_cursor(&self, inbox_id: i64, user_id: i64) -> Result<()>;
}
