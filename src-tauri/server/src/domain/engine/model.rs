//! Engine entities as stored and exposed by the API. Every one belongs to an organization (`account_id`).
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Activity {
    pub id: i64,
    pub account_id: i64,
    /// Who asked: `contact:<id>`, `user:<id>` or `agent:<id>` (a delegation).
    pub requester: String,
    pub agent_id: i64,
    pub parent_id: Option<i64>,
    pub status: String,
    pub priority: i64,
    pub deadline: Option<String>,
    pub request: String,
    pub result: Option<String>,
    /// Evidence ids the final answer cites.
    pub evidence: Vec<String>,
    pub error: Option<String>,
    pub idempotency_key: Option<String>,
    pub conversation_id: Option<i64>,
    pub correlation_id: String,
    pub attempts: i64,
    pub reply_state: Option<String>,
    pub created: String,
    pub updated: String,
}

/// A new activity; `idempotency_key` makes a repeated event return the existing one.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct ActivityDraft {
    pub account_id: i64,
    pub requester: String,
    pub agent_id: i64,
    pub parent_id: Option<i64>,
    pub priority: i64,
    pub deadline: Option<String>,
    pub request: String,
    pub idempotency_key: Option<String>,
    pub conversation_id: Option<i64>,
    pub correlation_id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Delegation {
    pub id: i64,
    pub account_id: i64,
    pub parent_activity_id: i64,
    pub activity_id: i64,
    pub from_agent_id: i64,
    pub to_agent_id: i64,
    pub skill: String,
    pub reason: Option<String>,
    pub request_key: String,
    pub correlation_id: String,
    pub depth: i64,
    pub hops: i64,
    pub created: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Run {
    pub id: i64,
    pub account_id: i64,
    pub activity_id: i64,
    pub agent_id: i64,
    pub runtime: String,
    pub model: Option<String>,
    pub external_id: Option<String>,
    pub status: String,
    pub attempt: i64,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cached_tokens: i64,
    pub cost_usd: Option<f64>,
    /// `reported` by the runtime or `estimated`.
    pub cost_source: Option<String>,
    pub error: Option<String>,
    pub started: String,
    pub finished: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ToolCall {
    pub id: i64,
    pub account_id: i64,
    pub activity_id: i64,
    pub run_id: i64,
    pub agent_id: i64,
    pub tool: String,
    pub args: Value,
    pub call_key: String,
    pub status: String,
    pub result: Option<Value>,
    pub evidence_id: Option<String>,
    pub decided_by: Option<i64>,
    pub created: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Evidence {
    pub id: String,
    pub account_id: i64,
    pub activity_id: i64,
    pub tool_call_id: Option<i64>,
    pub source: String,
    pub content: Value,
    pub created: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AgentMessage {
    pub id: i64,
    pub activity_id: i64,
    pub from_agent_id: Option<i64>,
    pub to_agent_id: Option<i64>,
    pub body: String,
    pub created: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AuditEvent {
    pub id: i64,
    pub activity_id: Option<i64>,
    pub agent_id: Option<i64>,
    pub action: String,
    pub outcome: String,
    pub detail: Value,
    pub at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Memory {
    pub id: i64,
    pub account_id: i64,
    pub agent_id: i64,
    /// `episodic`, `semantic` or `operational`.
    pub kind: String,
    pub content: String,
    pub source: Option<String>,
    /// `private` (only the agent) or `organization`.
    pub visibility: String,
    pub valid_until: Option<String>,
    pub version: i64,
    pub supersedes: Option<i64>,
    pub created: String,
}

/// How far an AI agent may go on its own, and its limits.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AgentPolicy {
    pub agent_id: i64,
    pub account_id: i64,
    pub enabled: bool,
    pub proactive_enabled: bool,
    pub execution_policy: String,
    pub max_concurrency: i64,
    pub run_timeout_secs: i64,
    pub monthly_token_budget: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ToolGrant {
    pub id: i64,
    pub account_id: i64,
    pub agent_id: i64,
    pub tool: String,
    /// `allow` or `approval`.
    pub effect: String,
    pub created: String,
}

/// An AI agent as the engine runs it: identity, runtime and what it knows (instructions and skills).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct EngineAgent {
    pub id: i64,
    pub account_id: i64,
    pub name: String,
    pub role: Option<String>,
    pub runtime: Option<String>,
    pub model: Option<String>,
    pub instructions: Option<String>,
    /// Names of the agent's and its profile's skills.
    pub skills: Vec<String>,
    /// Skill instructions, joined, for the run's system prompt.
    pub skill_text: String,
}
