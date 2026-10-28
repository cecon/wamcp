//! Agent memory: scoped (private or organization), versioned, correctable and erasable. Not a transcript.
use super::gateway::Caller;
use super::EngineService;
use crate::domain::engine::model::Memory;
use crate::domain::engine::tools::text_arg;
use crate::domain::error::{fail, Result};
use serde_json::{json, Value};

const KINDS: [&str; 3] = ["episodic", "semantic", "operational"];
const SCOPES: [&str; 2] = ["private", "organization"];

impl EngineService {
    pub(super) fn remember(&self, caller: &Caller, args: &Value) -> Result<Value> {
        let Some(content) = text_arg(args, "conteudo").filter(|c| c.chars().count() <= 2000) else {
            return fail("Informe o `conteudo` (até 2000 caracteres)");
        };
        let kind = text_arg(args, "tipo").unwrap_or_else(|| "episodic".into());
        let scope = text_arg(args, "escopo").unwrap_or_else(|| "private".into());
        if !KINDS.contains(&kind.as_str()) || !SCOPES.contains(&scope.as_str()) {
            return fail("`tipo` ou `escopo` inválido");
        }
        let memory = self.store.remember(&Memory {
            id: 0,
            account_id: caller.run.account_id,
            agent_id: caller.agent.id,
            kind,
            content,
            source: Some(format!("atividade:{}", caller.activity.id)),
            visibility: scope,
            valid_until: None,
            version: 1,
            supersedes: None,
            created: String::new(),
        })?;
        let detail = json!({"memoria": memory.id, "escopo": memory.visibility});
        self.audit(
            caller.run.account_id,
            Some(caller.activity.id),
            Some(caller.agent.id),
            "memory.remember",
            "stored",
            detail,
        );
        Ok(json!({"memoria": memory.id}))
    }

    pub(super) fn recall(&self, caller: &Caller, args: &Value) -> Result<Value> {
        let term = text_arg(args, "termo").unwrap_or_default();
        let found = self.store.recall(caller.run.account_id, caller.agent.id, &term)?;
        let items: Vec<Value> = found
            .iter()
            .map(|m| json!({"id": m.id, "tipo": m.kind, "conteudo": m.content, "escopo": m.visibility}))
            .collect();
        Ok(json!({"memorias": items}))
    }

    /// Memories an agent can see (for the API; the same scope rule as the tool).
    pub fn memories(&self, account_id: i64, agent_id: i64) -> Result<Vec<Memory>> {
        self.store.recall(account_id, agent_id, "")
    }

    pub fn correct_memory(&self, account_id: i64, id: i64, content: &str) -> Result<Memory> {
        if content.trim().is_empty() || content.chars().count() > 2000 {
            return fail("A memória precisa ter entre 1 e 2000 caracteres");
        }
        match self.store.correct_memory(account_id, id, content.trim())? {
            Some(memory) => Ok(memory),
            None => fail("Memória não encontrada"),
        }
    }

    pub fn forget_memory(&self, account_id: i64, id: i64) -> Result<()> {
        if !self.store.forget_memory(account_id, id)? {
            return fail("Memória não encontrada");
        }
        Ok(())
    }
}
