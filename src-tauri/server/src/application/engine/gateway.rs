//! The tool gateway: every tool call of every runtime lands here. The run token says who calls; the
//! grant and the execution policy say whether; repeated calls return the stored result.
use super::EngineService;
use crate::application::ports::{ToolGateway, ToolInfo, ToolReply};
use crate::domain::engine::activity::{self as status, call};
use crate::domain::engine::grants::{decide, Decision};
use crate::domain::engine::model::{Activity, EngineAgent, Evidence, Run, ToolCall};
use crate::domain::engine::tools::{self, ToolDef, TOOLS};
use crate::domain::error::{fail, Error, Result};
use async_trait::async_trait;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

/// Who is calling: the live run, its activity and agent.
pub(super) struct Caller {
    pub run: Run,
    pub activity: Activity,
    pub agent: EngineAgent,
}

#[async_trait]
impl ToolGateway for EngineService {
    async fn call_tool(&self, token: &str, name: &str, args: Value) -> ToolReply {
        match self.call(token, name, args).await {
            Ok(content) => ToolReply { ok: true, content },
            Err(Error::Helpdesk(error)) => ToolReply {
                ok: false,
                content: json!({"erro": error.message}),
            },
            Err(error) => {
                tracing::warn!(%error, tool = name, "engine tool failed");
                ToolReply {
                    ok: false,
                    content: json!({"erro": "Falha interna ao executar a ferramenta"}),
                }
            }
        }
    }

    fn list_tools(&self, token: &str) -> Vec<ToolInfo> {
        match self.caller(token) {
            Ok(caller) => self.tools_for(&caller.agent),
            Err(_) => Vec::new(),
        }
    }
}

impl EngineService {
    /// Built-in tools and the business tools the agent has a grant for.
    pub(super) fn tools_for(&self, agent: &EngineAgent) -> Vec<ToolInfo> {
        let granted: Vec<String> = self
            .store
            .grants(agent.account_id, agent.id)
            .map(|grants| grants.into_iter().map(|g| g.tool).collect())
            .unwrap_or_default();
        TOOLS
            .iter()
            .filter(|tool| tool.builtin || granted.iter().any(|g| g == tool.name))
            .map(|tool| ToolInfo {
                name: tool.name.into(),
                description: tool.description.into(),
                input_schema: tools::input_schema(tool.name),
            })
            .collect()
    }

    pub(super) fn caller(&self, token: &str) -> Result<Caller> {
        let Some(run) = self.store.run_by_token(token)? else {
            return fail("Credencial de execução inválida");
        };
        if run.status != status::run::RUNNING {
            return fail("Esta execução já terminou");
        }
        let activity = self.load(run.account_id, run.activity_id)?;
        let agent = self.agent(run.account_id, run.agent_id)?;
        Ok(Caller { run, activity, agent })
    }

    async fn call(&self, token: &str, name: &str, args: Value) -> Result<Value> {
        let caller = self.caller(token)?;
        if status::is_final(&caller.activity.status) {
            return fail("A atividade já terminou");
        }
        let Some(tool) = tools::find(name) else {
            return fail(format!("Ferramenta desconhecida: {name}"));
        };
        if !args.is_object() {
            return fail("Os argumentos precisam ser um objeto JSON");
        }
        match tool.name {
            tools::DELEGATE => self.delegate(&caller, &args).await,
            tools::CONCLUDE => self.conclude(&caller, &args).await,
            tools::REMEMBER => self.remember(&caller, &args),
            tools::RECALL => self.recall(&caller, &args),
            _ => self.business_call(&caller, tool, args).await,
        }
    }

    async fn business_call(&self, caller: &Caller, tool: &ToolDef, args: Value) -> Result<Value> {
        let (account, activity, agent) = (caller.run.account_id, &caller.activity, &caller.agent);
        let key = call_key(tool.name, &args);
        if let Some(previous) = self.store.tool_call_by_key(activity.id, &key)? {
            // Failed and denied calls are decided again (the tool may be back, a grant may exist now).
            if previous.status != call::FAILED && previous.status != call::DENIED {
                return replay(&previous);
            }
        }
        let grant = self
            .store
            .grants(account, agent.id)?
            .into_iter()
            .find(|g| g.tool == tool.name);
        let policy = self.store.policy(account, agent.id)?;
        let coordinator = agent.role.as_deref() == Some("coordinator");
        let draft = ToolCall {
            id: 0,
            account_id: account,
            activity_id: activity.id,
            run_id: caller.run.id,
            agent_id: agent.id,
            tool: tool.name.into(),
            args: args.clone(),
            call_key: key,
            status: call::FAILED.into(),
            result: None,
            evidence_id: None,
            decided_by: None,
            created: String::new(),
        };
        let detail = json!({"ferramenta": tool.name, "args": args});
        match decide(
            tool,
            grant.as_ref().map(|g| g.effect.as_str()),
            &policy.execution_policy,
            coordinator,
        ) {
            Decision::Deny(reason) => {
                self.save_call(ToolCall {
                    status: call::DENIED.into(),
                    ..draft
                })?;
                self.audit(
                    account,
                    Some(activity.id),
                    Some(agent.id),
                    "tool.call",
                    "denied",
                    detail,
                );
                fail(reason)
            }
            Decision::Approval => {
                let saved = self.save_call(ToolCall {
                    status: call::PENDING_APPROVAL.into(),
                    ..draft
                })?;
                self.store
                    .move_activity(activity.id, status::RUNNING, status::WAITING_APPROVAL, None)?;
                self.audit(
                    account,
                    Some(activity.id),
                    Some(agent.id),
                    "tool.call",
                    "approval_required",
                    detail,
                );
                Ok(json!({"status": "aguardando_aprovacao", "chamada": saved.id,
                    "mensagem": "Uma pessoa precisa aprovar esta ação. Encerre agora; a atividade será retomada."}))
            }
            Decision::Allow => {
                let saved = self.save_call(draft)?;
                self.run_business(account, activity.id, agent.id, &saved).await
            }
        }
    }

    /// Runs an allowed (or approved) business tool and stores its result as evidence.
    pub(super) async fn run_business(
        &self,
        account: i64,
        activity: i64,
        agent: i64,
        saved: &ToolCall,
    ) -> Result<Value> {
        let detail = json!({"ferramenta": saved.tool, "chamada": saved.id});
        match self.business.call(account, &saved.tool, &saved.args).await {
            Ok(result) => {
                let evidence = format!("ev_{}", uuid::Uuid::new_v4().simple());
                self.store.add_evidence(&Evidence {
                    id: evidence.clone(),
                    account_id: account,
                    activity_id: activity,
                    tool_call_id: Some(saved.id),
                    source: saved.tool.clone(),
                    content: json!({"args": saved.args, "resultado": result}),
                    created: String::new(),
                })?;
                self.store
                    .update_tool_call(saved.id, call::OK, Some(&result), Some(&evidence))?;
                self.audit(account, Some(activity), Some(agent), "tool.call", "allowed", detail);
                Ok(json!({"resultado": result, "evidence_id": evidence}))
            }
            Err(error) => {
                self.audit(
                    account,
                    Some(activity),
                    Some(agent),
                    "tool.call",
                    "failed",
                    json!({"ferramenta": saved.tool, "erro": error.to_string()}),
                );
                fail(format!("Ferramenta indisponível: {}", saved.tool))
            }
        }
    }

    fn save_call(&self, call: ToolCall) -> Result<ToolCall> {
        match self.store.tool_call_by_key(call.activity_id, &call.call_key)? {
            Some(previous) => {
                self.store.update_tool_call(previous.id, &call.status, None, None)?;
                Ok(ToolCall {
                    status: call.status,
                    ..previous
                })
            }
            None => self.store.insert_tool_call(&call),
        }
    }
}

/// What a repeated call returns: the stored result, never a second execution.
fn replay(previous: &ToolCall) -> Result<Value> {
    match previous.status.as_str() {
        call::OK => Ok(json!({"resultado": previous.result, "evidence_id": previous.evidence_id})),
        call::PENDING_APPROVAL => Ok(json!({"status": "aguardando_aprovacao", "chamada": previous.id})),
        _ => fail(format!("Uma pessoa negou {}", previous.tool)),
    }
}

/// The same tool with the same arguments (key order aside) is the same call.
pub(super) fn call_key(tool: &str, args: &Value) -> String {
    fn canonical(value: &Value) -> Value {
        match value {
            Value::Object(map) => {
                let mut keys: Vec<&String> = map.keys().collect();
                keys.sort();
                Value::Object(keys.into_iter().map(|k| (k.clone(), canonical(&map[k]))).collect())
            }
            Value::Array(items) => Value::Array(items.iter().map(canonical).collect()),
            Value::String(s) => Value::String(s.trim().to_lowercase()),
            other => other.clone(),
        }
    }
    hex::encode(Sha256::digest(format!("{tool}|{}", canonical(args)).as_bytes()))
}

impl EngineService {
    /// Whether a token belongs to a live run (the MCP endpoint's authentication).
    pub fn caller_ok(&self, token: &str) -> Result<()> {
        self.caller(token).map(drop)
    }
}
