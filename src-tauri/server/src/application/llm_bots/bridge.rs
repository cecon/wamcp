//! The bridge from conversations to the engine. When the inbox's AI agent runs on an engine runtime,
//! a customer's turn becomes an engine request on behalf of the contact: the agent works with its
//! plugins' tools (never the internal-only ones, since the turn came from a customer) and its
//! `concluir` answer is posted in the conversation by the engine. Other agents answer directly.
use super::LlmBotService;
use crate::application::engine::Submission;
use crate::domain::bridge::conversation_request;
use crate::domain::error::Result;
use crate::domain::model::{Conversation, Inbox, Message};

impl LlmBotService {
    /// Answers through the engine if the agent runs there; `false`: answer directly instead.
    pub(super) async fn answer_by_engine(
        &self,
        conversation: &Conversation,
        inbox: &Inbox,
        agent_id: i64,
        summary: Option<&str>,
        messages: &[Message],
    ) -> Result<bool> {
        let Some(engine) = self.engine.get().cloned() else {
            return Ok(false);
        };
        let Some(agent) = self.helpdesk.core.repo.agent(agent_id)? else {
            return Ok(false);
        };
        let on_engine = agent.runtime.as_deref().is_some_and(|r| engine.has_runtime(r));
        let account = conversation.account_id;
        if !on_engine || !engine.store.policy(account, agent_id)?.enabled {
            return Ok(false);
        }
        let Some(last) = messages.last() else {
            return Ok(false);
        };
        let submission = Submission {
            account_id: account,
            agent_id,
            request: conversation_request(&inbox.name, conversation.display_id, summary, messages),
            requester: format!("contact:{}", conversation.contact_id),
            conversation_id: Some(conversation.id),
            idempotency_key: Some(format!("conversation:{}:{}", conversation.id, last.id)),
            ..Submission::default()
        };
        let (activity, _) = engine.submit(&submission)?;
        // Its own task: stopping the answer drops this wait, never the engine's driver (the
        // request is cancelled through the engine).
        let id = activity.id;
        let driver = tokio::spawn(async move { engine.execute(account, id).await });
        match driver.await {
            Ok(outcome) => outcome.map(|_| true),
            Err(error) => crate::domain::error::fail(format!("Execução do motor interrompida: {error}")),
        }
    }
}
