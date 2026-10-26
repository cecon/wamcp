//! LLM providers behind the `Llm` port, routed by the bot's `provider` name. A new provider
//! (Codex CLI, OpenRouter, …) is one more adapter registered here and listed in `LLM_PROVIDERS`.
pub mod claude_cli;

use crate::application::ports::{Llm, LlmRequest};
use crate::domain::error::{fail, Result};
use async_trait::async_trait;
use serde_json::Value;
use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;

#[derive(Default)]
pub struct LlmRouter {
    providers: HashMap<String, Arc<dyn Llm>>,
}

impl LlmRouter {
    pub fn with(mut self, name: &str, provider: Arc<dyn Llm>) -> Self {
        self.providers.insert(name.into(), provider);
        self
    }

    /// Every provider available on this computer; `work_dir` holds their scratch files.
    pub fn local(work_dir: &Path) -> Self {
        Self::default().with(
            "claude_cli",
            Arc::new(claude_cli::ClaudeCli::new(work_dir.join("claude"))),
        )
    }
}

#[async_trait]
impl Llm for LlmRouter {
    async fn complete(&self, request: &LlmRequest) -> Result<Value> {
        match self.providers.get(&request.provider) {
            Some(provider) => provider.complete(request).await,
            None => fail(format!("Provedor de LLM indisponível: {}", request.provider)),
        }
    }
}
