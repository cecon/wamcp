//! The channels behind the inboxes, under one contract. A channel turns its own events into
//! conversation messages (through `HelpdeskService::receive`, in `inbound.rs`) and carries the
//! team's replies and actions back. The use cases never compare `channel_type`: they ask the
//! inbox's channel, and a new channel is one more implementation of `Channel`.
mod github;
mod whatsapp;

use super::helpdesk::HelpdeskService;
use super::ports::{MessageRef, SendRequest, Typing};
use crate::domain::channel::Capabilities;
use crate::domain::error::Result;
use crate::domain::github::GITHUB;
use crate::domain::model::{Inbox, Message};
use async_trait::async_trait;

/// Where a contact is on the channel: the inbox and the contact's address there (a WhatsApp JID,
/// a GitHub `owner/repo#number`).
pub struct Address<'a> {
    pub inbox: &'a Inbox,
    pub contact: &'a str,
}

/// One channel. Optional actions default to "not on this channel" (nothing to do); the use cases
/// check `capabilities` before offering them.
#[async_trait]
pub trait Channel: Send + Sync {
    fn capabilities(&self) -> Capabilities;
    /// Sends a stored reply and returns the channel's id for it (empty when it has none).
    async fn send(
        &self,
        helpdesk: &HelpdeskService,
        message: &Message,
        to: Address<'_>,
        request: SendRequest,
    ) -> Result<String>;
    async fn react(&self, _: &HelpdeskService, _: Address<'_>, _: &MessageRef, _: &str) -> Result<()> {
        Ok(())
    }
    async fn revoke(&self, _: &HelpdeskService, _: Address<'_>, _: &str) -> Result<()> {
        Ok(())
    }
    async fn typing(&self, _: &HelpdeskService, _: Address<'_>, _: Typing) -> Result<()> {
        Ok(())
    }
    async fn mark_read(&self, _: &HelpdeskService, _: Address<'_>, _: &[String]) -> Result<()> {
        Ok(())
    }
    async fn block(&self, _: &HelpdeskService, _: Address<'_>, _: bool) -> Result<()> {
        Ok(())
    }
}

static WHATSAPP_CHANNEL: whatsapp::WhatsAppChannel = whatsapp::WhatsAppChannel;
static GITHUB_CHANNEL: github::GithubChannel = github::GithubChannel;

/// The channel of a `channel_type` (inboxes without a known type are WhatsApp ones).
pub fn channel(channel_type: &str) -> &'static dyn Channel {
    match channel_type {
        GITHUB => &GITHUB_CHANNEL,
        _ => &WHATSAPP_CHANNEL,
    }
}

impl HelpdeskService {
    /// The channel of an inbox.
    pub(crate) fn channel(&self, inbox: &Inbox) -> &'static dyn Channel {
        channel(&inbox.channel_type)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::channel::capabilities;

    #[test]
    fn each_channel_reports_its_own_capabilities() {
        assert_eq!(channel(GITHUB).capabilities(), capabilities(GITHUB));
        assert_eq!(channel("whatsapp").capabilities(), capabilities("whatsapp"));
    }
}
