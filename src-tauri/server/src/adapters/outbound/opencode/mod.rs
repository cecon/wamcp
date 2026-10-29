//! OpenCode (MIT, https://github.com/anomalyco/opencode) as the engine's agent runtime: one
//! `opencode serve` per run, on 127.0.0.1 with a random password, in its own folder with its own
//! config dirs (the operator's global OpenCode config never leaks in). Every built-in tool is denied;
//! the only tools are the engine's, through its MCP endpoint with the run's token. Checked against
//! opencode 1.18.25; see docs/engine/adr-001-runtime.md.
mod events;
mod llm;
mod setup;

pub use llm::OpenCodeLlm;

use crate::application::ports::{AgentRuntime, RunEvent, RunSpec, RunState};
use crate::domain::error::{fail, Error, Result};
use async_trait::async_trait;
use parking_lot::Mutex;
use serde_json::{json, Value};
use setup::{config, find_program, free_port, serve_command, wait_ready};
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::mpsc::{unbounded_channel, UnboundedReceiver};

struct Live {
    _child: tokio::process::Child,
    base: String,
    password: String,
    dir: PathBuf,
    events: Option<UnboundedReceiver<RunEvent>>,
}

pub struct OpenCodeRuntime {
    program: Option<PathBuf>,
    work_dir: PathBuf,
    http: reqwest::Client,
    live: Arc<Mutex<HashMap<String, Live>>>,
}

impl OpenCodeRuntime {
    pub fn new(work_dir: PathBuf) -> Self {
        Self {
            program: find_program(),
            work_dir,
            http: reqwest::Client::new(),
            live: Arc::default(),
        }
    }

    fn post(&self, live: (&str, &str), path: &str, body: &Value) -> reqwest::RequestBuilder {
        self.http
            .post(format!("{}{path}", live.0))
            .basic_auth("opencode", Some(live.1))
            .json(body)
    }
}

/// Kills the run's server (dropping the child) and then removes its folder.
fn stop(live: &Mutex<HashMap<String, Live>>, session: &str) {
    if let Some(done) = live.lock().remove(session) {
        let dir = done.dir.clone();
        drop(done);
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(500)).await;
            let _ = std::fs::remove_dir_all(dir);
        });
    }
}

#[async_trait]
impl AgentRuntime for OpenCodeRuntime {
    fn check(&self) -> std::result::Result<(), String> {
        match &self.program {
            Some(path) => path
                .is_file()
                .then_some(())
                .ok_or_else(|| format!("{} não existe", path.display())),
            None => Err("OpenCode não encontrado (npm install -g opencode-ai)".into()),
        }
    }

    async fn start_run(&self, spec: RunSpec) -> Result<String> {
        let Some(program) = self.program.clone() else {
            return fail("OpenCode não está instalado neste computador");
        };
        let Some(mcp_url) = spec.mcp_url.clone() else {
            return fail("O endpoint MCP do motor não está disponível");
        };
        let Some((provider, model)) = spec.agent.model.as_deref().and_then(|m| m.split_once('/')) else {
            return fail("Defina o modelo do agente no formato provedor/modelo (ex.: openrouter/openai/gpt-5)");
        };
        let dir = self.work_dir.join(format!("run-{}", spec.run_id));
        std::fs::create_dir_all(dir.join("xdg").join("config")).map_err(Error::internal)?;
        let (port, password) = (free_port()?, uuid::Uuid::new_v4().simple().to_string());
        let config = config(&spec, &mcp_url, provider).to_string();
        let mut command = serve_command(&program, &dir, port, &password, &config, spec.api_key.as_deref());
        command
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .kill_on_drop(true);
        #[cfg(windows)]
        command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
        let child = command
            .spawn()
            .map_err(|e| Error::internal(format!("opencode serve: {e}")))?;
        let base = format!("http://127.0.0.1:{port}");
        wait_ready(&self.http, &base, &password).await?;
        let session: Value = self
            .post(
                (&base, &password),
                "/session",
                &json!({"title": format!("wamcp run {}", spec.run_id)}),
            )
            .send()
            .await
            .map_err(Error::internal)?
            .json()
            .await
            .map_err(Error::internal)?;
        let Some(session) = session["id"].as_str().map(str::to_string) else {
            return fail("O OpenCode não criou a sessão");
        };
        let events = self.subscribe(&base, &password, &session).await?;
        self.live.lock().insert(
            session.clone(),
            Live {
                _child: child,
                base: base.clone(),
                password: password.clone(),
                dir,
                events: Some(events),
            },
        );
        let body = json!({"parts": [{"type": "text", "text": spec.input}], "system": spec.system,
            "model": {"providerID": provider, "modelID": model}});
        let sent = self
            .post((&base, &password), &format!("/session/{session}/prompt_async"), &body)
            .send()
            .await;
        if !sent.as_ref().is_ok_and(|r| r.status().is_success()) {
            self.stop(&session);
            return fail("O OpenCode recusou o pedido da execução");
        }
        Ok(session)
    }

    async fn resume_run(&self, external_id: &str, input: &str) -> Result<()> {
        let Some((base, password)) = self.address(external_id) else {
            return fail("A sessão do OpenCode já foi encerrada; o motor inicia outra execução");
        };
        let body = json!({"parts": [{"type": "text", "text": input}]});
        self.post(
            (&base, &password),
            &format!("/session/{external_id}/prompt_async"),
            &body,
        )
        .send()
        .await
        .map_err(Error::internal)?;
        Ok(())
    }

    async fn cancel_run(&self, external_id: &str) -> Result<()> {
        if let Some((base, password)) = self.address(external_id) {
            let _ = self
                .post((&base, &password), &format!("/session/{external_id}/abort"), &json!({}))
                .send()
                .await;
        }
        self.stop(external_id);
        Ok(())
    }

    fn stream_events(&self, external_id: &str) -> Result<UnboundedReceiver<RunEvent>> {
        match self
            .live
            .lock()
            .get_mut(external_id)
            .and_then(|live| live.events.take())
        {
            Some(events) => Ok(events),
            None => fail("Eventos da execução indisponíveis"),
        }
    }

    async fn run_status(&self, external_id: &str) -> Result<RunState> {
        let Some((base, password)) = self.address(external_id) else {
            return Ok(RunState::Gone);
        };
        let status: Value = self
            .http
            .get(format!("{base}/session/status"))
            .basic_auth("opencode", Some(&password))
            .send()
            .await
            .map_err(Error::internal)?
            .json()
            .await
            .map_err(Error::internal)?;
        let busy = status[external_id]["type"].as_str().is_some_and(|t| t != "idle");
        Ok(if busy { RunState::Running } else { RunState::Idle })
    }
}

impl OpenCodeRuntime {
    fn address(&self, session: &str) -> Option<(String, String)> {
        self.live
            .lock()
            .get(session)
            .map(|l| (l.base.clone(), l.password.clone()))
    }

    fn stop(&self, session: &str) {
        stop(&self.live, session);
    }

    /// Follows `/event` for the session until a final event; then the run's server is stopped.
    async fn subscribe(&self, base: &str, password: &str, session: &str) -> Result<UnboundedReceiver<RunEvent>> {
        let response = self
            .http
            .get(format!("{base}/event"))
            .basic_auth("opencode", Some(password))
            .send()
            .await
            .map_err(Error::internal)?;
        let (tx, rx) = unbounded_channel();
        let (session, live) = (session.to_string(), self.live.clone());
        tokio::spawn(async move {
            let mut response = response;
            let mut buffer = String::new();
            while let Ok(Some(chunk)) = response.chunk().await {
                buffer.push_str(&String::from_utf8_lossy(&chunk));
                for event in events::drain_sse(&mut buffer) {
                    if events::session_of(&event) != Some(session.as_str()) {
                        continue;
                    }
                    let Some(mapped) = events::map(&event) else { continue };
                    let last = matches!(mapped, RunEvent::Completed | RunEvent::Failed(_) | RunEvent::Cancelled);
                    let _ = tx.send(mapped);
                    if last {
                        stop(&live, &session);
                        return;
                    }
                }
            }
            let _ = tx.send(RunEvent::Failed("O OpenCode encerrou a conexão de eventos".into()));
        });
        Ok(rx)
    }
}
