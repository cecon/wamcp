//! The helpdesk as the engine's reply channel: the answer goes out in the conversation as its inbox
//! bot, and the people who hear about a request get it in their chat with the agent (or the chat the
//! request came from), or on WhatsApp when they are contacts.
use crate::application::agent_chats::post_chat_message;
use crate::application::helpdesk::HelpdeskService;
use crate::application::ports::ReplyChannel;
use crate::domain::actor::Actor;
use crate::domain::engine::recipients::{Delivery, CHAT, CONTACT, USER};
use crate::domain::error::{fail, Result};
use crate::domain::model::{CHAT_AGENT, CHAT_ERROR};
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

    async fn deliver(&self, delivery: &Delivery) -> Result<()> {
        let (core, repo) = (&self.0.core, &self.0.core.repo);
        let role = if delivery.failed { CHAT_ERROR } else { CHAT_AGENT };
        match delivery.kind.as_str() {
            USER => {
                if repo.user(delivery.target_id)?.is_none_or(|u| u.active != 1) {
                    return fail("A pessoa não existe mais ou está inativa");
                }
                let chat = repo.agent_chat(delivery.target_id, delivery.agent_id)?;
                post_chat_message(core, chat.id, role, &delivery.text)?;
            }
            CHAT => {
                if repo.agent_chat_by_id(delivery.target_id)?.is_none() {
                    return fail("O chat do pedido não existe mais");
                }
                post_chat_message(core, delivery.target_id, role, &delivery.text)?;
            }
            CONTACT => {
                let inbox = repo.inboxes(None)?.into_iter().find(|i| i.channel_type == "whatsapp");
                let Some(inbox) = inbox else {
                    return fail("Não há caixa de WhatsApp para avisar o contato");
                };
                let actor = Actor::System {
                    kind: "agent".into(),
                    name: "Agente de IA".into(),
                };
                self.0
                    .start_conversation(&actor, delivery.target_id, inbox.id, Some(delivery.text.clone()))
                    .await?;
            }
            other => return fail(format!("Destinatário desconhecido: {other}")),
        }
        Ok(())
    }
}
