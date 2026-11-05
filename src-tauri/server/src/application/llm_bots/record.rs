//! Token/cost accounting for the chatbot calls (kept apart to stay within the file line limit).
use super::{LlmBotService, Responder};
use crate::application::ports::TokenUsage;
use crate::domain::model::LlmUsage;

impl LlmBotService {
    /// Keeps the tokens of the call: an AI agent's salary is the cost of its calls plus the margin.
    /// `run_ref` names what the call was for when it is not a conversation (`agent_chat:<id>`).
    pub(super) fn record(
        &self,
        responder: &Responder,
        conversation_id: Option<i64>,
        run_ref: Option<String>,
        usage: TokenUsage,
    ) {
        let usage = LlmUsage {
            agent_id: responder.agent_id,
            agent_bot_id: responder.agent_bot_id,
            conversation_id,
            run_ref,
            provider: responder.request.provider.clone(),
            model: responder.request.model.clone(),
            input_tokens: usage.input_tokens,
            cached_tokens: usage.cached_input_tokens,
            output_tokens: usage.output_tokens,
            cost: usage.cost_usd,
            currency: "USD".into(),
            cost_reported: usage.cost_usd.is_some(),
            at: self.helpdesk.core.clock.now_ms(),
        };
        if let Err(error) = self.helpdesk.core.repo.record_llm_usage(&usage) {
            tracing::warn!(%error, ?conversation_id, "uso de tokens não registrado");
        }
    }
}
