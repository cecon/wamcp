//! LLM providers behind the `Llm` port, routed by the AI agent's runtime (`provider`). A new
//! provider is one more adapter registered here and listed in `RUNTIMES`.
pub mod claude_cli;
pub mod codex_cli;
pub mod launcher;

use crate::application::ports::{Llm, LlmProviderStatus, LlmRequest};
use crate::domain::error::{fail, Result};
use async_trait::async_trait;
use serde_json::Value;
use std::collections::BTreeMap;
use std::path::Path;
use std::sync::Arc;

#[derive(Default)]
pub struct LlmRouter {
    providers: BTreeMap<String, Arc<dyn Llm>>,
}

impl LlmRouter {
    pub fn with(mut self, name: &str, provider: Arc<dyn Llm>) -> Self {
        self.providers.insert(name.into(), provider);
        self
    }

    /// Every runtime this computer may have; `work_dir` holds their scratch files.
    pub fn local(work_dir: &Path) -> Self {
        Self::default()
            .with(
                "claude_cli",
                Arc::new(claude_cli::ClaudeCli::new(work_dir.join("claude"))),
            )
            .with("codex_cli", Arc::new(codex_cli::CodexCli::new(work_dir.join("codex"))))
            .with(
                "openclaude",
                Arc::new(claude_cli::ClaudeCli::openclaude(work_dir.join("openclaude"))),
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

    fn providers(&self) -> Vec<LlmProviderStatus> {
        self.providers
            .iter()
            .map(|(id, provider)| {
                let location = provider.location();
                LlmProviderStatus {
                    id: id.clone(),
                    available: location.is_some(),
                    detail: location.unwrap_or_else(|| "Não instalado neste computador".into()),
                }
            })
            .collect()
    }
}
