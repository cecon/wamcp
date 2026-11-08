//! Reaches plugin tools outside the app: a JSON `POST` for HTTP tools, and `initialize` +
//! `tools/call` over Streamable HTTP for MCP servers (a JSON or an SSE answer). No redirects, a
//! short deadline and a bounded answer, so a slow or hostile endpoint cannot hold a run.
use crate::application::ports::PluginTransport;
use crate::domain::error::{fail, Result};
use async_trait::async_trait;
use serde_json::{json, Value};
use std::time::Duration;

const MAX_BODY: usize = 1024 * 1024;
const SESSION: &str = "mcp-session-id";

pub struct HttpPluginTransport {
    client: reqwest::Client,
}

impl HttpPluginTransport {
    pub fn new() -> Self {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(30))
            .redirect(reqwest::redirect::Policy::none())
            .user_agent("wamcp-plugins")
            .build()
            .unwrap_or_default();
        Self { client }
    }

    async fn post(
        &self,
        url: &str,
        bearer: Option<&str>,
        session: Option<&str>,
        body: &Value,
    ) -> Result<(Option<String>, String)> {
        let mut request = self
            .client
            .post(url)
            .header("accept", "application/json, text/event-stream")
            .json(body);
        if let Some(token) = bearer {
            request = request.bearer_auth(token);
        }
        if let Some(id) = session {
            request = request.header(SESSION, id);
        }
        let response = match request.send().await {
            Ok(response) => response,
            Err(error) => return fail(format!("Ferramenta fora do ar: {}", error.without_url())),
        };
        let status = response.status();
        let session = response
            .headers()
            .get(SESSION)
            .and_then(|v| v.to_str().ok())
            .map(String::from);
        let bytes = response.bytes().await.unwrap_or_default();
        if bytes.len() > MAX_BODY {
            return fail("A ferramenta respondeu mais de 1 MiB");
        }
        if !status.is_success() {
            return fail(format!("A ferramenta respondeu HTTP {}", status.as_u16()));
        }
        Ok((session, String::from_utf8_lossy(&bytes).into_owned()))
    }
}

impl Default for HttpPluginTransport {
    fn default() -> Self {
        Self::new()
    }
}

/// The JSON-RPC message of a JSON or SSE (`data:` lines) answer.
pub fn rpc_message(body: &str) -> Option<Value> {
    if let Ok(value) = serde_json::from_str::<Value>(body.trim()) {
        return Some(value);
    }
    body.lines()
        .filter_map(|line| line.strip_prefix("data:"))
        .filter_map(|data| serde_json::from_str::<Value>(data.trim()).ok())
        .find(|message| message.get("result").is_some() || message.get("error").is_some())
}

/// The result of `tools/call`: its structured content, else the text parts.
pub fn tool_result(message: &Value) -> Result<Value> {
    if let Some(error) = message.get("error") {
        return fail(format!(
            "A ferramenta recusou: {}",
            error["message"].as_str().unwrap_or("erro")
        ));
    }
    let result = &message["result"];
    let text: Vec<&str> = result["content"]
        .as_array()
        .map(|parts| parts.iter().filter_map(|p| p["text"].as_str()).collect())
        .unwrap_or_default();
    if result["isError"].as_bool() == Some(true) {
        return fail(format!("A ferramenta falhou: {}", text.join("\n")));
    }
    if let Some(structured) = result.get("structuredContent").filter(|v| !v.is_null()) {
        return Ok(structured.clone());
    }
    Ok(json!({ "texto": text.join("\n") }))
}

#[async_trait]
impl PluginTransport for HttpPluginTransport {
    async fn http(&self, url: &str, bearer: Option<&str>, args: &Value) -> Result<Value> {
        let (_, body) = self.post(url, bearer, None, args).await?;
        match serde_json::from_str(&body) {
            Ok(value) => Ok(value),
            Err(_) => Ok(json!({ "texto": body })),
        }
    }

    async fn manifest(&self, url: &str) -> Result<Value> {
        if !crate::domain::plugins::allowed_url(url) {
            return fail("Endereço do plugin: use HTTPS (HTTP só local)");
        }
        let response = match self.client.get(url).header("accept", "application/json").send().await {
            Ok(response) => response,
            Err(error) => return fail(format!("Não consegui baixar o plugin: {}", error.without_url())),
        };
        let status = response.status();
        let bytes = response.bytes().await.unwrap_or_default();
        if !status.is_success() {
            return fail(format!("O endereço do plugin respondeu HTTP {}", status.as_u16()));
        }
        if bytes.len() > MAX_BODY {
            return fail("O manifesto passa de 1 MiB");
        }
        match serde_json::from_slice(&bytes) {
            Ok(value) => Ok(value),
            Err(_) => fail("O endereço não devolveu um plugin.json válido"),
        }
    }

    async fn mcp(&self, url: &str, bearer: Option<&str>, tool: &str, args: &Value) -> Result<Value> {
        let initialize = json!({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {
            "protocolVersion": "2025-06-18", "capabilities": {},
            "clientInfo": {"name": "wamcp", "version": env!("CARGO_PKG_VERSION")}}});
        let (session, _) = self.post(url, bearer, None, &initialize).await?;
        let initialized = json!({"jsonrpc": "2.0", "method": "notifications/initialized"});
        // Servers answer the notification with 202 and no body; a refusal here is not fatal.
        let _ = self.post(url, bearer, session.as_deref(), &initialized).await;
        let call = json!({"jsonrpc": "2.0", "id": 2, "method": "tools/call",
            "params": {"name": tool, "arguments": args}});
        let (_, body) = self.post(url, bearer, session.as_deref(), &call).await?;
        match rpc_message(&body) {
            Some(message) => tool_result(&message),
            None => fail("A ferramenta MCP respondeu algo que não é JSON-RPC"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_json_and_sse_answers() {
        let sse = "event: message\ndata: {\"jsonrpc\":\"2.0\",\"id\":2,\"result\":{\"content\":[{\"type\":\"text\",\"text\":\"ok\"}]}}\n\n";
        let message = rpc_message(sse).unwrap();
        assert_eq!(tool_result(&message).unwrap(), json!({"texto": "ok"}));
        let structured = json!({"result": {"content": [], "structuredContent": {"total": 3}}});
        assert_eq!(tool_result(&structured).unwrap(), json!({"total": 3}));
        let failed = json!({"result": {"isError": true, "content": [{"type": "text", "text": "sem estoque"}]}});
        assert!(tool_result(&failed).is_err());
        assert!(tool_result(&json!({"error": {"message": "x"}})).is_err());
    }
}
