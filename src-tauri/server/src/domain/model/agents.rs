use serde::{Deserialize, Serialize};

/// A member of the agent roster: a person (consulted on their WhatsApp) or an AI agent (run by a runtime).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RosterAgent {
    pub id: i64,
    pub name: String,
    /// `human` or `ai`.
    pub kind: String,
    /// `coordinator`, `operator`, `dev_support` or `qa`, from the profile (people may have none).
    pub role: Option<String>,
    /// The mandatory profile: permissions and the AI role.
    pub profile_id: Option<i64>,
    pub profile_name: Option<String>,
    pub description: Option<String>,
    /// Humans: optional helpdesk login and the WhatsApp the agents ask questions on.
    pub user_id: Option<i64>,
    pub user_name: Option<String>,
    pub user_email: Option<String>,
    pub whatsapp_jid: Option<String>,
    /// AI agents: the agentic runtime, an optional model and the agent's own instructions.
    pub runtime: Option<String>,
    pub model: Option<String>,
    pub instructions: Option<String>,
    pub active: bool,
    pub skill_ids: Vec<i64>,
    pub credential_count: i64,
    pub created: String,
}

/// Fields of an agent to create (`id` 0) or replace.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct RosterAgentDraft {
    pub id: i64,
    pub name: String,
    pub kind: String,
    /// Filled from the profile by the use case ("" for a person whose profile has no role).
    pub role: String,
    pub profile_id: Option<i64>,
    pub description: Option<String>,
    pub user_id: Option<i64>,
    pub whatsapp_jid: Option<String>,
    pub runtime: Option<String>,
    pub model: Option<String>,
    pub instructions: Option<String>,
    pub active: bool,
}

/// What an operator knows how to do: instructions (like a Claude Code `SKILL.md`) and the tools it may call.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Skill {
    pub id: i64,
    pub name: String,
    pub description: Option<String>,
    pub instructions: String,
    pub tools: Vec<String>,
    pub created: String,
}

/// A secret an AI agent's tools use on the server side; the secret itself is never returned.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AgentCredential {
    pub id: i64,
    pub agent_id: i64,
    pub name: String,
    /// `api_key`, `bearer`, `basic` or `secret`.
    pub kind: String,
    pub created: String,
    pub last_used: Option<String>,
}
