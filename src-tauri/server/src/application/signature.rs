//! Agent replies reach WhatsApp with the agent's public name in bold on the first line, so the
//! customer knows who is answering (per inbox, on by default). The helpdesk keeps the text as typed.
use super::helpdesk::HelpdeskService;
use super::ports::SendRequest;
use crate::domain::helpdesk::signed;
use crate::domain::model::{Inbox, Message};

impl HelpdeskService {
    /// The agent's display name, else the name (only for replies written by agents).
    fn public_agent_name(&self, message: &Message) -> Option<String> {
        if message.sender_type.as_deref() != Some("user") {
            return None;
        }
        let user = message.sender_id.and_then(|id| self.core.repo.user(id).ok().flatten());
        let display = user
            .as_ref()
            .and_then(|u| u.display_name.clone())
            .filter(|name| !name.trim().is_empty());
        display
            .or_else(|| user.map(|u| u.name))
            .or_else(|| message.sender_name.clone())
    }

    pub(super) fn sign_for_whatsapp(&self, message: &Message, inbox: &Inbox, mut request: SendRequest) -> SendRequest {
        if inbox.show_agent_name == 0 {
            return request;
        }
        let Some(agent) = self.public_agent_name(message) else {
            return request;
        };
        request.text = request.text.map(|text| signed(&text, &agent));
        // Only captioned files carry the name (extra files of the same reply go without it).
        if let Some(media) = request.media.as_mut() {
            media.caption = media.caption.take().map(|caption| signed(&caption, &agent));
        }
        request
    }
}
