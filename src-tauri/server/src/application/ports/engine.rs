//! Ports of the agentic engine: its store, the agent runtime (vendor-neutral), the tool gateway the
//! runtime calls back into, the business tools and the channel the final answer goes out on.
use crate::domain::engine::model::{
    Activity, ActivityDraft, AgentMessage, AgentPolicy, AuditEvent, Delegation, EngineAgent, Evidence, Memory, Run,
    ToolCall, ToolGrant,
};
use crate::domain::error::Result;
use async_trait::async_trait;
use serde_json::Value;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::mpsc::UnboundedReceiver;

/// Tokens and cost one run reported.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Usage {
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cached_tokens: i64,
    /// `None` when the runtime does not report cost (it is then estimated).
    pub cost_usd: Option<f64>,
}

/// Normalised events of a run, whatever the runtime.
#[derive(Debug, Clone, PartialEq)]
pub enum RunEvent {
    Started,
    MessageDelta(String),
    ToolRequested { tool: String },
    ApprovalRequired { call_id: i64 },
    ToolCompleted { tool: String, ok: bool },
    DelegationRequested { skill: String },
    UsageReported(Usage),
    Completed,
    Failed(String),
    Cancelled,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RunState {
    Running,
    Idle,
    Gone,
}

/// A tool as offered to the runtime.
#[derive(Debug, Clone, PartialEq)]
pub struct ToolInfo {
    pub name: String,
    pub description: String,
    pub input_schema: Value,
}

/// What a tool call returns to the model (`ok` false = an error the model should read).
#[derive(Debug, Clone, PartialEq)]
pub struct ToolReply {
    pub ok: bool,
    pub content: Value,
}

/// The engine's single entry for tools: the MCP endpoint and in-process runtimes both call it.
#[async_trait]
pub trait ToolGateway: Send + Sync {
    async fn call_tool(&self, token: &str, name: &str, args: Value) -> ToolReply;
    fn list_tools(&self, token: &str) -> Vec<ToolInfo>;
}

/// Everything a runtime needs to start one run. Tools reach the engine through `mcp_url` (with
/// `token` as the bearer) or, for in-process runtimes, through `gateway` with the same token.
#[derive(Clone)]
pub struct RunSpec {
    pub run_id: i64,
    pub account_id: i64,
    pub agent: EngineAgent,
    pub system: String,
    pub input: String,
    pub tools: Vec<ToolInfo>,
    pub token: String,
    pub mcp_url: Option<String>,
    pub gateway: Arc<dyn ToolGateway>,
    pub api_key: Option<String>,
    pub timeout: Duration,
}

/// An agentic runtime (OpenCode, a scripted one for tests, …). It owns no identity, memory or task.
#[async_trait]
pub trait AgentRuntime: Send + Sync {
    /// Whether it can run on this computer (`Err` says why not).
    fn check(&self) -> std::result::Result<(), String> {
        Ok(())
    }
    /// Starts a run and returns its id in the runtime.
    async fn start_run(&self, spec: RunSpec) -> Result<String>;
    /// Sends more input (an approval decision, a tool result) to a run that is still known.
    async fn resume_run(&self, external_id: &str, input: &str) -> Result<()>;
    async fn cancel_run(&self, external_id: &str) -> Result<()>;
    /// The run's events until it ends; taken once per start or resume.
    fn stream_events(&self, external_id: &str) -> Result<UnboundedReceiver<RunEvent>>;
    async fn run_status(&self, external_id: &str) -> Result<RunState>;
}

/// Business tools behind grants (the MVP has a simulated finance system).
#[async_trait]
pub trait BusinessTools: Send + Sync {
    /// `Err` = the tool is unavailable; a domain answer ("not found") is `Ok`.
    async fn call(&self, account_id: i64, tool: &str, args: &Value) -> Result<Value>;
}

/// Where a root activity's final answer goes: the conversation it came from.
#[async_trait]
pub trait ReplyChannel: Send + Sync {
    async fn reply(&self, conversation_id: i64, text: &str) -> Result<()>;
}

/// Engine storage. Every query is scoped to `account_id` unless it says otherwise.
pub trait EngineRepo: Send + Sync {
    fn engine_agent(&self, account_id: i64, agent_id: i64) -> Result<Option<EngineAgent>>;
    /// Active AI agents of the organization that have the skill (their own or their profile's).
    fn agents_with_skill(&self, account_id: i64, skill: &str) -> Result<Vec<EngineAgent>>;
    /// Every active AI agent of the organization (the competence directory).
    fn directory(&self, account_id: i64) -> Result<Vec<EngineAgent>>;
    fn policy(&self, account_id: i64, agent_id: i64) -> Result<AgentPolicy>;
    fn save_policy(&self, policy: &AgentPolicy) -> Result<()>;
    fn grants(&self, account_id: i64, agent_id: i64) -> Result<Vec<ToolGrant>>;
    /// `effect` `None` removes the grant.
    fn set_grant(&self, account_id: i64, agent_id: i64, tool: &str, effect: Option<&str>) -> Result<()>;

    /// Returns the existing activity (and `false`) when the idempotency key was seen.
    fn create_activity(&self, draft: &ActivityDraft) -> Result<(Activity, bool)>;
    fn activity(&self, account_id: i64, id: i64) -> Result<Option<Activity>>;
    fn activities(&self, account_id: i64, limit: i64) -> Result<Vec<Activity>>;
    /// Compare-and-set; returns whether the status was `from` and is now `to`.
    fn move_activity(&self, id: i64, from: &str, to: &str, error: Option<&str>) -> Result<bool>;
    /// Records the answer; returns `false` if the activity was already final.
    fn complete_activity(&self, id: i64, result: &str, evidence: &[String]) -> Result<bool>;
    fn set_reply_state(&self, id: i64, state: Option<&str>) -> Result<()>;
    fn add_attempt(&self, id: i64) -> Result<i64>;
    /// Root activities of every organization left unfinished (startup recovery).
    fn unfinished_roots(&self) -> Result<Vec<Activity>>;

    fn delegation_by_key(&self, parent_id: i64, request_key: &str) -> Result<Option<Delegation>>;
    fn create_delegation(&self, delegation: &Delegation) -> Result<Delegation>;
    fn delegations(&self, account_id: i64, correlation_id: &str) -> Result<Vec<Delegation>>;
    /// Agents from the root activity down to `activity_id` (the delegation chain).
    fn chain(&self, activity_id: i64) -> Result<Vec<i64>>;

    fn create_run(&self, activity: &Activity, runtime: &str, model: Option<&str>, token: &str) -> Result<Run>;
    fn run_by_token(&self, token: &str) -> Result<Option<Run>>;
    fn runs(&self, account_id: i64, activity_id: i64) -> Result<Vec<Run>>;
    fn set_run_external(&self, id: i64, external_id: &str) -> Result<()>;
    fn finish_run(&self, id: i64, status: &str, error: Option<&str>) -> Result<()>;
    fn reopen_run(&self, id: i64) -> Result<()>;
    fn add_usage(&self, id: i64, usage: &Usage, cost_source: &str) -> Result<()>;
    /// Marks every `running` run `interrupted` (startup); returns how many.
    fn interrupt_runs(&self) -> Result<usize>;
    /// Tokens the agent used since `since` (ISO time).
    fn tokens_since(&self, account_id: i64, agent_id: i64, since: &str) -> Result<i64>;

    fn tool_call_by_key(&self, activity_id: i64, call_key: &str) -> Result<Option<ToolCall>>;
    fn tool_call(&self, account_id: i64, id: i64) -> Result<Option<ToolCall>>;
    fn tool_calls(&self, account_id: i64, activity_id: i64) -> Result<Vec<ToolCall>>;
    fn insert_tool_call(&self, call: &ToolCall) -> Result<ToolCall>;
    fn update_tool_call(&self, id: i64, status: &str, result: Option<&Value>, evidence_id: Option<&str>) -> Result<()>;
    fn decide_tool_call(&self, id: i64, status: &str, decided_by: i64) -> Result<bool>;

    fn add_evidence(&self, evidence: &Evidence) -> Result<()>;
    /// Evidence of the activity and of every activity delegated below it.
    fn evidence_ids_below(&self, activity_id: i64) -> Result<Vec<String>>;
    fn evidence(&self, account_id: i64, activity_id: i64) -> Result<Vec<Evidence>>;

    fn add_message(
        &self,
        account_id: i64,
        activity_id: i64,
        from: Option<i64>,
        to: Option<i64>,
        body: &str,
    ) -> Result<()>;
    fn messages(&self, account_id: i64, activity_id: i64) -> Result<Vec<AgentMessage>>;
    fn audit(
        &self,
        account_id: i64,
        activity_id: Option<i64>,
        agent_id: Option<i64>,
        action: &str,
        outcome: &str,
        detail: &Value,
    ) -> Result<()>;
    fn audit_events(&self, account_id: i64, activity_id: i64) -> Result<Vec<AuditEvent>>;

    fn remember(&self, memory: &Memory) -> Result<Memory>;
    /// Memories visible to the agent: its own and the organization's, live and not superseded.
    fn recall(&self, account_id: i64, agent_id: i64, term: &str) -> Result<Vec<Memory>>;
    /// A corrected version that supersedes `id`.
    fn correct_memory(&self, account_id: i64, id: i64, content: &str) -> Result<Option<Memory>>;
    fn forget_memory(&self, account_id: i64, id: i64) -> Result<bool>;
}
