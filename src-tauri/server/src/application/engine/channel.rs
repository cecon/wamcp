//! The helpdesk as the engine's reply channel: the answer goes out in the conversation as its inbox bot.
use crate::application::helpdesk::HelpdeskService;
use crate::application::ports::ReplyChannel;
use crate::domain::actor::Actor;
use crate::domain::error::{fail, Result};
use async_trait::async_trait;

pub struct HelpdeskChannel(pub HelpdeskService);

#[async_trait]
impl ReplyChannel for HelpdeskChannel {
    async fn reply(&self, conversation_id: i64, text: &str) -> Result<()> {
        let Some(conversation) = self.0.core.repo.conversation_by_id(conversation_id)? else {
            return fail("Conversa de origem não encontrada");
        };
        let actor = Actor::Bot {
            inbox_id: conversation.inbox_id,
        };
        self.0.reply(&actor, conversation.display_id, text, false).await?;
        Ok(())
    }
}
