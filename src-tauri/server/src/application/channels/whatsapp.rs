//! The WhatsApp channel: replies, reactions, deletions, presence and blocking through the inbox's
//! WhatsApp session. Agent replies carry the agent's name when the inbox asks for it.
use super::{Address, Channel};
use crate::application::helpdesk::HelpdeskService;
use crate::application::ports::{MessageRef, SendRequest, Typing};
use crate::domain::channel::{capabilities, Capabilities, WHATSAPP};
use crate::domain::error::Result;
use crate::domain::model::Message;
use async_trait::async_trait;

pub struct WhatsAppChannel;

#[async_trait]
impl Channel for WhatsAppChannel {
    fn capabilities(&self) -> Capabilities {
        capabilities(WHATSAPP)
    }

    async fn send(
        &self,
        helpdesk: &HelpdeskService,
        message: &Message,
        to: Address<'_>,
        request: SendRequest,
    ) -> Result<String> {
        let request = helpdesk.sign_for_whatsapp(message, to.inbox, request);
        helpdesk.whatsapp.send_message(&to.inbox.session_id, &request).await
    }

    async fn react(&self, helpdesk: &HelpdeskService, to: Address<'_>, target: &MessageRef, emoji: &str) -> Result<()> {
        helpdesk
            .whatsapp
            .react(&to.inbox.session_id, to.contact, target, emoji)
            .await
    }

    async fn revoke(&self, helpdesk: &HelpdeskService, to: Address<'_>, message_id: &str) -> Result<()> {
        helpdesk
            .whatsapp
            .revoke(&to.inbox.session_id, to.contact, message_id)
            .await
    }

    async fn typing(&self, helpdesk: &HelpdeskService, to: Address<'_>, state: Typing) -> Result<()> {
        helpdesk.whatsapp.typing(&to.inbox.session_id, to.contact, state).await
    }

    async fn mark_read(&self, helpdesk: &HelpdeskService, to: Address<'_>, message_ids: &[String]) -> Result<()> {
        helpdesk
            .whatsapp
            .mark_read(&to.inbox.session_id, to.contact, message_ids)
            .await
    }

    async fn block(&self, helpdesk: &HelpdeskService, to: Address<'_>, blocked: bool) -> Result<()> {
        helpdesk.whatsapp.block(&to.inbox.session_id, to.contact, blocked).await
    }
}
