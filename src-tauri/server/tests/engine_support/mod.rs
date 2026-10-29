//! Engine test harness: a scripted agent runtime (deterministic stand-in for OpenCode that calls the
//! same tool gateway), an organization seeded with Lu (coordinator) and Anny (finance operator), a
//! recording reply channel and the engine wired to them.
#![allow(dead_code)]
use async_trait::async_trait;
use futures::future::BoxFuture;
use parking_lot::Mutex;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::mpsc::{unbounded_channel, UnboundedReceiver};
use wamcp_server::adapters::outbound::finance_mock::FinanceMock;
use wamcp_server::adapters::outbound::sqlite::SqliteStore;
use wamcp_server::application::engine::{EngineDeps, EngineService};
use wamcp_server::application::ports::{
    AgentRuntime, EngineRepo, ReplyChannel, RunEvent, RunSpec, RunState, ToolGateway, ToolReply, Usage,
};
use wamcp_server::domain::error::{fail, Result};

/// One run as the script sees it: who runs, the input and the engine's tools behind the run's token.
pub struct Turn {
    pub agent: String,
    pub input: String,
    pub system: String,
    pub tools: Vec<String>,
    gateway: Arc<dyn ToolGateway>,
    token: String,
}

impl Turn {
    pub async fn call(&self, tool: &str, args: Value) -> ToolReply {
        self.gateway.call_tool(&self.token, tool, args).await
    }
}

pub enum Outcome {
    Done,
    Fail(String),
    /// Never finishes (a stuck model, or a process about to be killed).
    Hang,
}

pub type Script = Arc<dyn Fn(Turn) -> BoxFuture<'static, Outcome> + Send + Sync>;

#[derive(Default)]
pub struct ScriptedRuntime {
    scripts: Mutex<HashMap<String, Script>>,
    events: Mutex<HashMap<String, UnboundedReceiver<RunEvent>>>,
    /// (agent name, input) of every run started.
    pub starts: Mutex<Vec<(String, String)>>,
    pub cancelled: Mutex<Vec<String>>,
}

impl ScriptedRuntime {
    pub fn script(&self, agent: &str, script: Script) {
        self.scripts.lock().insert(agent.into(), script);
    }

    pub fn runs_of(&self, agent: &str) -> usize {
        self.starts.lock().iter().filter(|(a, _)| a == agent).count()
    }
}

#[async_trait]
impl AgentRuntime for ScriptedRuntime {
    async fn start_run(&self, spec: RunSpec) -> Result<String> {
        let Some(script) = self.scripts.lock().get(&spec.agent.name).cloned() else {
            return fail(format!("sem roteiro para {}", spec.agent.name));
        };
        self.starts.lock().push((spec.agent.name.clone(), spec.input.clone()));
        let external = format!("scripted-{}", spec.run_id);
        let (tx, rx) = unbounded_channel();
        self.events.lock().insert(external.clone(), rx);
        let turn = Turn {
            agent: spec.agent.name.clone(),
            input: spec.input.clone(),
            system: spec.system.clone(),
            tools: spec.tools.iter().map(|t| t.name.clone()).collect(),
            gateway: spec.gateway.clone(),
            token: spec.token.clone(),
        };
        tokio::spawn(async move {
            let _ = tx.send(RunEvent::Started);
            let outcome = script(turn).await;
            let usage = Usage {
                input_tokens: 1000,
                output_tokens: 200,
                cached_tokens: 0,
                cost_usd: None,
            };
            let _ = tx.send(RunEvent::UsageReported(usage));
            match outcome {
                Outcome::Done => drop(tx.send(RunEvent::Completed)),
                Outcome::Fail(error) => drop(tx.send(RunEvent::Failed(error))),
                Outcome::Hang => {
                    tokio::time::sleep(Duration::from_secs(3600)).await;
                    drop(tx);
                }
            }
        });
        Ok(external)
    }

    async fn resume_run(&self, _external_id: &str, _input: &str) -> Result<()> {
        fail("roteiros não são retomados")
    }

    async fn cancel_run(&self, external_id: &str) -> Result<()> {
        self.cancelled.lock().push(external_id.into());
        Ok(())
    }

    fn stream_events(&self, external_id: &str) -> Result<UnboundedReceiver<RunEvent>> {
        match self.events.lock().remove(external_id) {
            Some(rx) => Ok(rx),
            None => fail("sem eventos"),
        }
    }

    async fn run_status(&self, _external_id: &str) -> Result<RunState> {
        Ok(RunState::Gone)
    }
}

/// Records what the engine posts to conversations.
#[derive(Default)]
pub struct RecordingChannel {
    pub replies: Mutex<Vec<(i64, String)>>,
}

#[async_trait]
impl ReplyChannel for RecordingChannel {
    async fn reply(&self, conversation_id: i64, text: &str) -> Result<()> {
        self.replies.lock().push((conversation_id, text.into()));
        Ok(())
    }
}

pub fn engine(store: Arc<SqliteStore>, runtime: Arc<ScriptedRuntime>, channel: Arc<RecordingChannel>) -> EngineService {
    EngineService::new(EngineDeps {
        store: store as Arc<dyn EngineRepo>,
        runtimes: vec![("scripted".into(), runtime as Arc<dyn AgentRuntime>)],
        default_runtime: "scripted".into(),
        business: Arc::new(FinanceMock),
        channel,
        keys: Arc::new(|_| None),
        mcp_url: None,
    })
}

pub struct Org {
    pub account: i64,
    pub lu: i64,
    pub anny: i64,
}

fn profile(store: &SqliteStore, role: &str) -> i64 {
    store
        .scalar(
            "SELECT id FROM custom_roles WHERE agent_role=? ORDER BY id LIMIT 1",
            vec![role.to_string().into()],
        )
        .unwrap()
        .unwrap()
}

/// An AI agent of the organization, with the given skills (created on demand).
pub fn ai_agent(store: &SqliteStore, account: i64, name: &str, role: &str, skills: &[&str]) -> i64 {
    let id = store
        .insert(
            "INSERT INTO agents(name,kind,role,profile_id,runtime,model,instructions,active,created,account_id)
             VALUES(?,'ai',?,?,'scripted','teste/modelo','Seja objetiva.',1,'2026-10-28T00:00:00Z',?)",
            vec![
                name.to_string().into(),
                role.to_string().into(),
                profile(store, role).into(),
                account.into(),
            ],
        )
        .unwrap();
    for skill in skills {
        store
            .exec(
                "INSERT OR IGNORE INTO skills(name,instructions,tools,created) VALUES(?,?,'[]','2026-10-28T00:00:00Z')",
                vec![skill.to_string().into(), format!("Como fazer {skill}.").into()],
            )
            .unwrap();
        store
            .exec(
                "INSERT INTO agent_skills(agent_id,skill_id) SELECT ?,id FROM skills WHERE name=?",
                vec![id.into(), skill.to_string().into()],
            )
            .unwrap();
    }
    id
}

/// Lu (coordinator) and Anny (finance operator with the payment tool granted) in `account`.
pub fn seed(store: &SqliteStore, account: i64) -> Org {
    if account != 1 {
        store
            .exec(
                "INSERT OR IGNORE INTO accounts(id,name,created) VALUES(?,?,'2026-10-28T00:00:00Z')",
                vec![account.into(), format!("Empresa {account}").into()],
            )
            .unwrap();
    }
    let lu = ai_agent(store, account, &format!("Lu{account}"), "coordinator", &["recepcao"]);
    let anny = ai_agent(
        store,
        account,
        &format!("Anny{account}"),
        "operator",
        &["consultar_pagamento"],
    );
    store
        .set_grant(account, anny, "financeiro.consultar_pagamento", Some("allow"))
        .unwrap();
    Org { account, lu, anny }
}

/// The customer named in a request like "O cliente ACME pagou?".
pub fn customer(input: &str) -> String {
    let after = input.split("cliente ").nth(1).unwrap_or_default();
    let word = after.split_whitespace().next().unwrap_or_default();
    word.trim_matches(|c: char| !c.is_alphanumeric()).to_string()
}

/// Lu delegates the payment question and answers with what Anny found, citing her evidence.
pub fn lu_script() -> Script {
    Arc::new(|turn: Turn| {
        Box::pin(async move {
            let request = format!("O cliente {} pagou?", customer(&turn.input));
            let answer = turn
                .call("delegar", json!({"skill": "consultar_pagamento", "pedido": request}))
                .await;
            let content = answer.content;
            if content["status"] == "aguardando_aprovacao" {
                return Outcome::Done;
            }
            let (text, evidence) = if content["status"] == "concluida" {
                (
                    format!("Segundo a Anny: {}", content["resposta"].as_str().unwrap_or_default()),
                    content["evidencias"].clone(),
                )
            } else {
                (
                    format!(
                        "Não consegui a informação: {}",
                        content["erro"].as_str().unwrap_or("erro")
                    ),
                    json!([]),
                )
            };
            turn.call("concluir", json!({"resposta": text, "evidencias": evidence}))
                .await;
            Outcome::Done
        })
    })
}

/// Anny checks the finance tool and answers with the result and its evidence.
pub fn anny_script() -> Script {
    Arc::new(|turn: Turn| {
        Box::pin(async move {
            let who = customer(&turn.input);
            let reply = turn
                .call("financeiro.consultar_pagamento", json!({"cliente": who}))
                .await;
            let content = reply.content;
            if content["status"] == "aguardando_aprovacao" {
                return Outcome::Done;
            }
            let answer = if reply.ok {
                let r = &content["resultado"];
                json!({"resposta": format!("{}: {} (valor {}, data {})", r["cliente"], r["status"], r["valor"], r["data_pagamento"]),
                       "evidencias": [content["evidence_id"]]})
            } else {
                json!({"resposta": format!("Não consegui consultar: {}", content["erro"].as_str().unwrap_or_default())})
            };
            turn.call("concluir", answer).await;
            Outcome::Done
        })
    })
}

pub fn standard(runtime: &ScriptedRuntime, org: &Org) {
    runtime.script(&format!("Lu{}", org.account), lu_script());
    runtime.script(&format!("Anny{}", org.account), anny_script());
}
