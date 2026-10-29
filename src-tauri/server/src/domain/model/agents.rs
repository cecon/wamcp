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
    /// Skills inherited from the profile (on top of the agent's own).
    #[serde(default)]
    pub profile_skill_ids: Vec<i64>,
    pub credential_count: i64,
    /// The app's own agent (one at most): administrators talk to it to set the app up; it never
    /// answers customers and cannot be removed.
    #[serde(default)]
    pub system: bool,
    pub created: String,
    /// Who the agent answers to in the organization (the coordinator or person it takes work from).
    #[serde(default)]
    pub supervisor_id: Option<i64>,
    /// Avatar choices (`hair`, `outfit`, `accessory`, `skin`, `color`); `{}` uses the defaults.
    #[serde(default)]
    pub avatar: serde_json::Value,
    /// People with a login: `online`, `busy` or `offline`.
    #[serde(default)]
    pub availability: Option<String>,
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
    pub supervisor_id: Option<i64>,
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

/// A credential with its encrypted secret, read only by the server when it runs the agent.
#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct SealedCredential {
    pub name: String,
    pub kind: String,
    pub secret: String,
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

/// Tokens one model call spent for an AI agent (or a legacy `llm` bot), recorded when it answers.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct LlmUsage {
    pub agent_id: Option<i64>,
    pub agent_bot_id: Option<i64>,
    pub conversation_id: Option<i64>,
    /// The execution this call belongs to (an agent run or task), when there is one.
    pub run_ref: Option<String>,
    /// The runtime or provider that answered (`claude_cli`, …).
    pub provider: String,
    pub model: Option<String>,
    /// Prompt tokens, cached ones included; `cached_tokens` says how many were cache reads.
    pub input_tokens: i64,
    pub cached_tokens: i64,
    pub output_tokens: i64,
    /// `None` when nobody knows the cost (Codex reports none).
    pub cost: Option<f64>,
    /// ISO code of `cost` (`USD` for the runtimes).
    pub currency: String,
    /// Whether `cost` came from the provider (`true`) or was estimated from a price table.
    pub cost_reported: bool,
    /// When the call ended (epoch ms).
    pub at: i64,
}

/// An AI agent's usage over a period.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct UsageTotal {
    pub agent_id: i64,
    pub calls: i64,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cost_usd: f64,
    /// Calls whose runtime reported no cost: their tokens are not in the salary.
    pub unpriced_calls: i64,
}

/// One day of an agent's usage (`day` is `YYYY-MM-DD`, UTC).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct UsageDay {
    pub day: String,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cost_usd: f64,
}

/// A member's salary for a month: a person's seat, or an AI agent's token cost plus the margin.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
pub struct Salary {
    pub agent_id: i64,
    pub kind: String,
    /// Month to date for the current month, in reais.
    pub salary_brl: f64,
    pub calls: i64,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cost_usd: f64,
    pub unpriced_calls: i64,
}

/// A change the system agent wants to make, executed only after an administrator approves it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SystemProposal {
    pub id: i64,
    pub conversation_id: i64,
    pub after_message_id: i64,
    /// `create_skill`, `create_agent`, `set_agent_skills` or `connect_inbox`.
    pub action: String,
    pub args: serde_json::Value,
    pub summary: String,
    /// `pending`, `done`, `failed` or `discarded`.
    pub status: String,
    pub result: Option<String>,
    pub created_at: i64,
    pub decided_at: Option<i64>,
}
