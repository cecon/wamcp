//! What each channel of an inbox can do. The use cases ask the channel's capabilities instead of
//! comparing `channel_type`, so a new channel declares its own and the helpdesk follows.
use super::github::GITHUB;
use serde::Serialize;

pub const WHATSAPP: &str = "whatsapp";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct Capabilities {
    /// Files, images, audio and video go out with a reply.
    pub media: bool,
    /// Reactions reach the contact.
    pub reactions: bool,
    /// A sent message can be deleted for everyone.
    pub revoke: bool,
    /// "Typing…" and read receipts reach the contact.
    pub presence: bool,
    /// The contact can be blocked on the channel.
    pub block: bool,
    /// The team can start a conversation (otherwise only the channel's events open one).
    pub starts_conversations: bool,
}

const WHATSAPP_CAPABILITIES: Capabilities = Capabilities {
    media: true,
    reactions: true,
    revoke: true,
    presence: true,
    block: true,
    starts_conversations: true,
};

const GITHUB_CAPABILITIES: Capabilities = Capabilities {
    media: false,
    reactions: false,
    revoke: false,
    presence: false,
    block: false,
    starts_conversations: false,
};

/// The capabilities of a `channel_type`. Inboxes without a known type are WhatsApp ones (the
/// first channel, before `channel_type` had other values).
pub fn capabilities(channel_type: &str) -> Capabilities {
    match channel_type {
        GITHUB => GITHUB_CAPABILITIES,
        _ => WHATSAPP_CAPABILITIES,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn github_only_takes_text_replies() {
        let github = capabilities(GITHUB);
        assert!(!github.media && !github.reactions && !github.revoke && !github.starts_conversations);
    }

    #[test]
    fn whatsapp_and_unknown_types_do_everything() {
        assert_eq!(capabilities(WHATSAPP), WHATSAPP_CAPABILITIES);
        assert_eq!(capabilities(""), WHATSAPP_CAPABILITIES);
    }
}
