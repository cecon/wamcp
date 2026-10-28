//! `delegar`: the competence directory picks who has the skill in the same organization; the engine
//! creates a child activity with a correlated, hop-limited delegation and runs it to the end.
use super::gateway::Caller;
use super::EngineService;
use crate::domain::engine::activity as status;
use crate::domain::engine::delegation::{check, request_key};
use crate::domain::engine::model::{ActivityDraft, Delegation};
use crate::domain::engine::tools::text_arg;
use crate::domain::error::{fail, Result};
use serde_json::{json, Value};

impl EngineService {
    pub(super) async fn delegate(&self, caller: &Caller, args: &Value) -> Result<Value> {
        let (Some(skill), Some(request)) = (text_arg(args, "skill"), text_arg(args, "pedido")) else {
            return fail("Informe `skill` e `pedido`");
        };
        let reason = text_arg(args, "motivo");
        let (account, parent, from) = (caller.run.account_id, &caller.activity, &caller.agent);
        let key = request_key(&skill, &request);
        let child_id = match self.store.delegation_by_key(parent.id, &key)? {
            Some(existing) => existing.activity_id,
            None => {
                let chain = self.store.chain(parent.id)?;
                let candidates = self.store.agents_with_skill(account, &skill)?;
                // Someone outside the chain if possible; otherwise the cycle check below refuses it.
                let outside = candidates.iter().find(|a| a.id != from.id && !chain.contains(&a.id));
                let Some(to) = outside.or_else(|| candidates.iter().find(|a| a.id != from.id)) else {
                    let detail = json!({"skill": skill, "candidatos": candidates.len()});
                    self.audit(
                        account,
                        Some(parent.id),
                        Some(from.id),
                        "delegation.request",
                        "no_agent",
                        detail,
                    );
                    return fail(format!(
                        "Nenhum outro agente de IA desta organização tem a skill \"{skill}\""
                    ));
                };
                let hops = match check(&chain, to.id) {
                    Ok(hops) => hops,
                    Err(error) => {
                        let detail = json!({"skill": skill, "para": to.id, "erro": error.to_string()});
                        self.audit(
                            account,
                            Some(parent.id),
                            Some(from.id),
                            "delegation.request",
                            "blocked",
                            detail,
                        );
                        return Err(error);
                    }
                };
                let (child, _) = self.store.create_activity(&ActivityDraft {
                    account_id: account,
                    requester: format!("agent:{}", from.id),
                    agent_id: to.id,
                    parent_id: Some(parent.id),
                    priority: parent.priority,
                    deadline: parent.deadline.clone(),
                    request: request.clone(),
                    idempotency_key: Some(format!("delegation:{}:{key}", parent.id)),
                    conversation_id: None,
                    correlation_id: parent.correlation_id.clone(),
                })?;
                self.store.create_delegation(&Delegation {
                    id: 0,
                    account_id: account,
                    parent_activity_id: parent.id,
                    activity_id: child.id,
                    from_agent_id: from.id,
                    to_agent_id: to.id,
                    skill: skill.clone(),
                    reason,
                    request_key: key,
                    correlation_id: parent.correlation_id.clone(),
                    depth: hops,
                    hops,
                    created: String::new(),
                })?;
                self.store
                    .add_message(account, child.id, Some(from.id), Some(to.id), &request)?;
                let detail = json!({"skill": skill, "para": to.id, "atividade": child.id, "hops": hops});
                self.audit(
                    account,
                    Some(parent.id),
                    Some(from.id),
                    "delegation.request",
                    "delegated",
                    detail,
                );
                child.id
            }
        };
        let child = Box::pin(self.execute(account, child_id)).await?;
        let to = child.agent_id;
        match child.status.as_str() {
            status::COMPLETED => {
                let answer = child.result.clone().unwrap_or_default();
                if !self
                    .store
                    .messages(account, child.id)?
                    .iter()
                    .any(|m| m.from_agent_id == Some(to))
                {
                    self.store
                        .add_message(account, child.id, Some(to), Some(from.id), &answer)?;
                }
                Ok(json!({"status": "concluida", "atividade": child.id, "resposta": answer,
                    "evidencias": child.evidence}))
            }
            status::WAITING_APPROVAL => {
                // The parent waits too; it is run again once the child is decided and finishes.
                self.store
                    .move_activity(parent.id, status::RUNNING, status::WAITING_APPROVAL, None)?;
                Ok(json!({"status": "aguardando_aprovacao", "atividade": child.id,
                    "mensagem": "A tarefa delegada aguarda aprovação de uma pessoa. Encerre agora."}))
            }
            _ => Ok(json!({"status": "falhou", "atividade": child.id,
                "erro": child.error.unwrap_or_else(|| "A tarefa delegada não terminou".into())})),
        }
    }
}
