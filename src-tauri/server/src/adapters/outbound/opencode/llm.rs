//! OpenCode as an `Llm` (AI agents answering inboxes): one isolated `opencode serve` per call, no
//! tools at all, the answer as JSON Schema structured output (`format: json_schema`) read from the
//! assistant message, with its tokens and cost. Same isolation as the engine's runs.
use super::setup::{base_config, find_program, free_port, serve_command, wait_ready};
use crate::application::ports::{Completion, Llm, LlmRequest, TokenUsage};
use crate::domain::error::{fail, Error, Result};
use async_trait::async_trait;
use serde_json::{json, Value};
use std::path::PathBuf;
use std::process::Stdio;
use std::time::Duration;

pub struct OpenCodeLlm {
    program: Option<PathBuf>,
    work_dir: PathBuf,
    http: reqwest::Client,
    timeout: Duration,
}

impl OpenCodeLlm {
    pub fn new(work_dir: PathBuf) -> Self {
        Self {
            program: find_program(),
            work_dir,
            http: reqwest::Client::new(),
            timeout: Duration::from_secs(180),
        }
    }

    async fn ask(
        &self,
        base: &str,
        password: &str,
        request: &LlmRequest,
        provider: &str,
        model: &str,
    ) -> Result<Value> {
        let post = |path: String, body: Value| {
            self.http
                .post(format!("{base}{path}"))
                .basic_auth("opencode", Some(password))
                .json(&body)
        };
        let session: Value = post("/session".into(), json!({"title": "wamcp"}))
            .send()
            .await
            .map_err(Error::internal)?
            .json()
            .await
            .map_err(Error::internal)?;
        let Some(id) = session["id"].as_str() else {
            return fail("O OpenCode não criou a sessão");
        };
        let body = json!({"parts": [{"type": "text", "text": request.prompt}], "system": request.system,
            "model": {"providerID": provider, "modelID": model},
            "format": {"type": "json_schema", "schema": request.schema}});
        post(format!("/session/{id}/message"), body)
            .send()
            .await
            .map_err(Error::internal)?
            .json()
            .await
            .map_err(Error::internal)
    }
}

/// The structured answer, tokens and cost of `POST /session/{id}/message` (opencode 1.18.25 schema).
pub fn parse_message(reply: &Value) -> Result<Completion> {
    let info = &reply["info"];
    // A failed request (unknown model, provider without key) is an error object instead of a message.
    let failed = reply.get("info").is_none().then_some(reply);
    if let Some(error) = failed.or_else(|| info.get("error")).filter(|e| !e.is_null()) {
        let message = error["data"]["message"].as_str().or_else(|| error["name"].as_str());
        return fail(format!("OpenCode: {}", message.unwrap_or("erro")));
    }
    let Some(answer) = info.get("structured").filter(|v| v.is_object()) else {
        return fail("OpenCode respondeu sem a saída estruturada");
    };
    let tokens = &info["tokens"];
    let int = |v: &Value| v.as_f64().map_or(0, |f| f as i64);
    let cached = int(&tokens["cache"]["read"]);
    Ok(Completion {
        answer: answer.clone(),
        usage: TokenUsage {
            input_tokens: int(&tokens["input"]) + cached + int(&tokens["cache"]["write"]),
            cached_input_tokens: cached,
            output_tokens: int(&tokens["output"]) + int(&tokens["reasoning"]),
            cost_usd: info["cost"].as_f64(),
        },
    })
}

#[async_trait]
impl Llm for OpenCodeLlm {
    async fn complete(&self, request: &LlmRequest) -> Result<Completion> {
        let Some(program) = &self.program else {
            return fail(
                "OpenCode não encontrado. Instale com npm install -g opencode-ai ou defina WAMCP_OPENCODE_BIN.",
            );
        };
        let Some((provider, model)) = request.model.as_deref().map(str::trim).and_then(|m| m.split_once('/')) else {
            return fail("Informe no agente o modelo no formato provedor/modelo (ex.: openrouter/openai/gpt-5)");
        };
        let dir = self.work_dir.join(uuid::Uuid::new_v4().simple().to_string());
        std::fs::create_dir_all(dir.join("xdg").join("config")).map_err(Error::internal)?;
        let (port, password) = (free_port()?, uuid::Uuid::new_v4().simple().to_string());
        let config = base_config(provider, request.api_key.is_some()).to_string();
        let mut command = serve_command(program, &dir, port, &password, &config, request.api_key.as_deref());
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
        let reply = tokio::time::timeout(self.timeout, async {
            wait_ready(&self.http, &base, &password).await?;
            self.ask(&base, &password, request, provider, model).await
        })
        .await;
        drop(child);
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(500)).await;
            let _ = std::fs::remove_dir_all(dir);
        });
        match reply {
            Ok(reply) => parse_message(&reply?),
            Err(_) => fail("OpenCode excedeu o tempo limite"),
        }
    }

    fn location(&self) -> Option<String> {
        self.program
            .as_ref()
            .filter(|p| p.is_file())
            .map(|p| p.to_string_lossy().into_owned())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_structured_answer_tokens_and_cost() {
        let reply = json!({"info": {"structured": {"reply": "Olá", "handoff": false}, "cost": 0.002,
            "tokens": {"input": 900, "output": 40, "reasoning": 10, "cache": {"read": 100, "write": 0}}}, "parts": []});
        let done = parse_message(&reply).unwrap();
        assert_eq!(done.answer, json!({"reply": "Olá", "handoff": false}));
        assert_eq!(
            done.usage,
            TokenUsage {
                input_tokens: 1000,
                cached_input_tokens: 100,
                output_tokens: 50,
                cost_usd: Some(0.002)
            }
        );
        let failed = json!({"info": {"error": {"name": "ProviderAuthError", "data": {"message": "chave inválida"}}}});
        assert_eq!(
            parse_message(&failed).unwrap_err().to_string(),
            "OpenCode: chave inválida"
        );
        assert!(parse_message(&json!({"info": {}})).is_err());
        let refused = json!({"name": "UnknownError", "data": {"message": "Unexpected server error"}});
        assert_eq!(
            parse_message(&refused).unwrap_err().to_string(),
            "OpenCode: Unexpected server error"
        );
    }
}
