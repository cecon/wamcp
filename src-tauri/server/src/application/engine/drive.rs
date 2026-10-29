//! One run of an activity: start it on the agent's runtime, follow its events within the time limit,
//! record usage, and judge the outcome by the activity's state (only `concluir` completes it).
use super::EngineService;
use crate::application::ports::{RunEvent, RunSpec, ToolGateway, Usage};
use crate::domain::engine::activity::{self as status, run};
use crate::domain::engine::model::{Activity, AgentPolicy, EngineAgent};
use crate::domain::engine::{estimate_cost, prompt, PRICE_REFERENCE};
use serde_json::json;
use std::sync::Arc;
use std::time::Duration;

pub(super) enum RunEnd {
    /// The activity completed or waits for an approval.
    Done,
    Failed(String),
}

impl EngineService {
    pub(super) async fn run_once(&self, activity: &Activity, agent: &EngineAgent, policy: &AgentPolicy) -> RunEnd {
        match self.try_run(activity, agent, policy).await {
            Ok(end) => end,
            Err(error) => RunEnd::Failed(error.to_string()),
        }
    }

    async fn try_run(
        &self,
        activity: &Activity,
        agent: &EngineAgent,
        policy: &AgentPolicy,
    ) -> crate::domain::error::Result<RunEnd> {
        let (runtime_id, runtime) = self.runtime_for(agent)?;
        let token = format!("{}{}", uuid::Uuid::new_v4().simple(), uuid::Uuid::new_v4().simple());
        let record = self
            .store
            .create_run(activity, &runtime_id, agent.model.as_deref(), &token)?;
        let (account, id) = (activity.account_id, Some(activity.id));
        let directory = self.store.directory(account)?;
        let memories = self.store.recall(account, agent.id, "")?;
        let timeout = Duration::from_secs(u64::try_from(policy.run_timeout_secs).unwrap_or(180));
        let spec = RunSpec {
            run_id: record.id,
            account_id: account,
            agent: agent.clone(),
            system: prompt::system(agent, &directory, &memories),
            input: self.run_input(activity)?,
            tools: self.tools_for(agent),
            token,
            mcp_url: self.mcp_url.clone(),
            gateway: Arc::new(self.clone()) as Arc<dyn ToolGateway>,
            api_key: (self.keys)(agent),
            timeout,
        };
        self.audit(
            account,
            id,
            Some(agent.id),
            "run.start",
            &runtime_id,
            json!({"run": record.id, "tentativa": record.attempt}),
        );
        let external = match runtime.start_run(spec).await {
            Ok(external) => external,
            Err(error) => return Ok(self.end_run(activity, record.id, Some(&error.to_string()))),
        };
        self.store.set_run_external(record.id, &external)?;
        let mut events = runtime.stream_events(&external)?;
        let failure = tokio::time::timeout(timeout, async {
            while let Some(event) = events.recv().await {
                match event {
                    RunEvent::UsageReported(usage) => self.record_usage(record.id, &usage),
                    RunEvent::Completed => return None,
                    RunEvent::Failed(error) => return Some(error),
                    RunEvent::Cancelled => return Some("Execução cancelada".to_string()),
                    _ => {}
                }
            }
            None
        })
        .await;
        let error = match failure {
            Ok(error) => error,
            Err(_) => {
                let _ = runtime.cancel_run(&external).await;
                Some(format!("Tempo esgotado ({}s)", timeout.as_secs()))
            }
        };
        Ok(self.end_run(activity, record.id, error.as_deref()))
    }

    /// Closes the run record and judges the outcome by the activity's state.
    fn end_run(&self, activity: &Activity, run_id: i64, error: Option<&str>) -> RunEnd {
        let state = self
            .store
            .activity(activity.account_id, activity.id)
            .ok()
            .flatten()
            .map(|a| a.status)
            .unwrap_or_default();
        let done = status::is_final(&state) || state == status::WAITING_APPROVAL;
        let error = match (done, error) {
            (true, _) => None,
            (false, Some(error)) => Some(error.to_string()),
            (false, None) => Some("A execução terminou sem chamar `concluir`".to_string()),
        };
        let outcome = if error.is_some() { run::FAILED } else { run::COMPLETED };
        let _ = self.store.finish_run(run_id, outcome, error.as_deref());
        self.audit(
            activity.account_id,
            Some(activity.id),
            Some(activity.agent_id),
            "run.end",
            outcome,
            json!({"run": run_id, "erro": error}),
        );
        match error {
            Some(error) => RunEnd::Failed(error),
            None => RunEnd::Done,
        }
    }

    fn record_usage(&self, run_id: i64, usage: &Usage) {
        let (usage, source) = match usage.cost_usd {
            Some(_) => (usage.clone(), "reported"),
            None => {
                let cost = estimate_cost(usage.input_tokens, usage.output_tokens, usage.cached_tokens);
                (
                    Usage {
                        cost_usd: Some(cost),
                        ..usage.clone()
                    },
                    "estimated",
                )
            }
        };
        if let Err(error) = self.store.add_usage(run_id, &usage, source) {
            tracing::warn!(%error, run_id, price = PRICE_REFERENCE, "engine usage not recorded");
        }
    }

    /// The request, plus what earlier runs of this activity already got (tool calls are idempotent).
    fn run_input(&self, activity: &Activity) -> crate::domain::error::Result<String> {
        let calls = self.store.tool_calls(activity.account_id, activity.id)?;
        let mut input = format!("Pedido (atividade #{}): {}", activity.id, activity.request);
        let done: Vec<String> = calls
            .iter()
            .filter(|c| c.status != crate::domain::engine::activity::call::PENDING_APPROVAL)
            .map(|c| {
                format!(
                    "- {} {} → {} {}",
                    c.tool,
                    c.args,
                    c.status,
                    c.result.clone().unwrap_or_default()
                )
            })
            .collect();
        if !done.is_empty() {
            input.push_str(&format!(
                "\n\nEsta atividade foi retomada. Chamadas já feitas (repetir devolve o mesmo resultado):\n{}",
                done.join("\n")
            ));
        }
        Ok(input)
    }
}
