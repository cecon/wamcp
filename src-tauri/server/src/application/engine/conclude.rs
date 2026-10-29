//! `concluir`: the final answer, citing only evidence the engine produced for this activity tree. A
//! root activity with a conversation posts the answer there exactly once.
use super::gateway::Caller;
use super::EngineService;
use crate::domain::engine::activity::reply;
use crate::domain::engine::tools::text_arg;
use crate::domain::error::{fail, Result};
use serde_json::{json, Value};

impl EngineService {
    pub(super) async fn conclude(&self, caller: &Caller, args: &Value) -> Result<Value> {
        let Some(answer) = text_arg(args, "resposta") else {
            return fail("Informe a `resposta`");
        };
        let cited: Vec<String> = args
            .get("evidencias")
            .and_then(Value::as_array)
            .map(|items| items.iter().filter_map(Value::as_str).map(str::to_string).collect())
            .unwrap_or_default();
        let (account, activity, agent) = (caller.run.account_id, &caller.activity, &caller.agent);
        let known = self.store.evidence_ids_below(activity.id)?;
        if let Some(unknown) = cited.iter().find(|id| !known.contains(id)) {
            let detail = json!({"evidencia": unknown});
            self.audit(
                account,
                Some(activity.id),
                Some(agent.id),
                "activity.conclude",
                "unknown_evidence",
                detail,
            );
            return fail(format!(
                "Evidência desconhecida: {unknown}. Cite só ids devolvidos pelas ferramentas desta atividade"
            ));
        }
        if let (None, Some(conversation)) = (activity.parent_id, activity.conversation_id) {
            if activity.reply_state.as_deref() != Some(reply::SENT) {
                self.store.set_reply_state(activity.id, Some(reply::SENDING))?;
                if let Err(error) = self.channel.reply(conversation, &answer).await {
                    self.store.set_reply_state(activity.id, None)?;
                    let detail = json!({"erro": error.to_string()});
                    self.audit(
                        account,
                        Some(activity.id),
                        Some(agent.id),
                        "activity.reply",
                        "failed",
                        detail,
                    );
                    return fail("Não consegui enviar a resposta ao canal de origem");
                }
                self.store.set_reply_state(activity.id, Some(reply::SENT))?;
            }
        }
        if !self.store.complete_activity(activity.id, &answer, &cited)? {
            return Ok(json!({"status": "ja_concluida"}));
        }
        let detail = json!({"evidencias": cited});
        self.audit(
            account,
            Some(activity.id),
            Some(agent.id),
            "activity.conclude",
            "completed",
            detail,
        );
        if let Some(parent) = activity.parent_id {
            self.resume_waiting_parent(account, parent);
        }
        Ok(json!({"status": "concluida"}))
    }
}
