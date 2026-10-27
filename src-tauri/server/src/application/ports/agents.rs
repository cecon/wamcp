use crate::domain::error::Result;
use crate::domain::model::{AgentCredential, RosterAgent, RosterAgentDraft, SealedCredential, Skill};

/// The agent roster: human and AI agents, skills and encrypted credentials.
pub trait AgentsRepo {
    fn agents(&self) -> Result<Vec<RosterAgent>>;
    fn agent(&self, id: i64) -> Result<Option<RosterAgent>>;
    /// Inserts when `id` is 0, otherwise replaces every field.
    fn save_agent(&self, agent: &RosterAgentDraft) -> Result<RosterAgent>;
    fn delete_agent(&self, id: i64) -> Result<()>;
    fn set_agent_skills(&self, agent_id: i64, skill_ids: &[i64]) -> Result<()>;

    fn skills(&self) -> Result<Vec<Skill>>;
    fn skill(&self, id: i64) -> Result<Option<Skill>>;
    fn skill_name_taken(&self, name: &str, except_id: i64) -> Result<bool>;
    /// Inserts when `id` is 0, otherwise replaces name, description, instructions and tools.
    fn save_skill(&self, skill: &Skill) -> Result<Skill>;
    fn delete_skill(&self, id: i64) -> Result<()>;

    fn agent_credentials(&self, agent_id: i64) -> Result<Vec<AgentCredential>>;
    fn agent_credential_name_taken(&self, agent_id: i64, name: &str) -> Result<bool>;
    /// `sealed` is the encrypted secret; it is stored but never read back by listings.
    fn add_agent_credential(&self, agent_id: i64, name: &str, kind: &str, sealed: &str) -> Result<AgentCredential>;
    /// Returns whether a credential of that agent was removed.
    fn delete_agent_credential(&self, agent_id: i64, id: i64) -> Result<bool>;
    /// The encrypted secrets, only for running the agent.
    fn agent_sealed_credentials(&self, agent_id: i64) -> Result<Vec<SealedCredential>>;
    /// Which AI agent answers the inbox (`None` disconnects it).
    fn set_inbox_ai_agent(&self, inbox_id: i64, agent_id: Option<i64>) -> Result<()>;
}
