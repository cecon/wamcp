//! The summary of the start of a long conversation (see `domain/summary.rs`): kept per
//! conversation and refreshed with the agent's own model once the prompt's window has moved past
//! what it covers. A failed refresh never blocks the answer: the older summary (or none) is used.
use super::{LlmBotService, Responder};
use crate::application::ports::ConversationSummary;
use crate::domain::error::Result;
use crate::domain::llm::TRANSCRIPT_LIMIT;
use crate::domain::model::Message;
use crate::domain::summary::{
    parse_summary, summary_prompt, summary_schema, KEEP_RECENT, SUMMARY_BATCH, SUMMARY_SYSTEM,
};

impl LlmBotService {
    /// What came before `window` (the latest messages, oldest first), or `None` if it is all there.
    pub(super) async fn earlier_summary(
        &self,
        conversation_id: i64,
        window: &[Message],
        responder: &Responder,
    ) -> Option<String> {
        match self.refresh_summary(conversation_id, window, responder).await {
            Ok(summary) => summary,
            Err(error) => {
                tracing::warn!(%error, conversation_id, "resumo da conversa não atualizado");
                let repo = &self.helpdesk.core.repo;
                repo.conversation_summary(conversation_id)
                    .ok()
                    .flatten()
                    .map(|s| s.summary)
            }
        }
    }

    async fn refresh_summary(
        &self,
        conversation_id: i64,
        window: &[Message],
        responder: &Responder,
    ) -> Result<Option<String>> {
        let repo = &self.helpdesk.core.repo;
        let Some(first) = window
            .first()
            .filter(|_| window.len() >= usize::try_from(TRANSCRIPT_LIMIT).unwrap_or(40))
        else {
            return Ok(None);
        };
        let Some(before) = repo.messages(conversation_id, Some(first.id), 1)?.pop() else {
            return Ok(None);
        };
        let stored = repo.conversation_summary(conversation_id)?;
        if let Some(stored) = stored.as_ref().filter(|s| s.upto_message_id >= before.id) {
            return Ok(Some(stored.summary.clone()));
        }
        // Covers everything but the latest KEEP_RECENT messages of the window.
        let cut = &window[window.len().saturating_sub(KEEP_RECENT)];
        let covered = stored.as_ref().map_or(0, |s| s.upto_message_id);
        let fresh: Vec<Message> = repo
            .messages(conversation_id, Some(cut.id), SUMMARY_BATCH)?
            .into_iter()
            .filter(|m| m.id > covered)
            .collect();
        let Some(last) = fresh.last() else {
            return Ok(stored.map(|s| s.summary));
        };
        let mut request = responder.request.clone();
        request.system = SUMMARY_SYSTEM.into();
        request.prompt = summary_prompt(stored.as_ref().map(|s| s.summary.as_str()), &fresh);
        request.schema = summary_schema();
        request.mcp = None;
        let completion = self.llm.complete(&request).await?;
        self.record(responder, Some(conversation_id), None, completion.usage);
        let Some(summary) = parse_summary(&completion.answer) else {
            return crate::domain::error::fail("Resumo fora do formato esperado");
        };
        repo.save_conversation_summary(&ConversationSummary {
            conversation_id,
            summary: summary.clone(),
            upto_message_id: last.id,
        })?;
        Ok(Some(summary))
    }
}
