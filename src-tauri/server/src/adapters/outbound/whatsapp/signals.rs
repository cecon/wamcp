//! What a WhatsApp message means beyond its content: the quoted message, reactions, deletions and
//! edits of earlier messages.
use whatsapp_rust::prelude::*;

/// An action on an earlier message of the same chat (identified by its WhatsApp id).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Signal {
    /// An empty emoji removes the reaction.
    Reaction {
        target: String,
        emoji: String,
    },
    Revoke {
        target: String,
    },
    Edit {
        target: String,
        text: String,
    },
}

/// The id of the message being answered (`contextInfo.stanzaId`), if any.
pub fn quoted_id(message: &wa::Message) -> Option<String> {
    let b = message.get_base_message();
    let contexts = [
        b.extended_text_message
            .as_option()
            .and_then(|m| m.context_info.as_option()),
        b.image_message.as_option().and_then(|m| m.context_info.as_option()),
        b.video_message.as_option().and_then(|m| m.context_info.as_option()),
        b.audio_message.as_option().and_then(|m| m.context_info.as_option()),
        b.document_message.as_option().and_then(|m| m.context_info.as_option()),
        b.sticker_message.as_option().and_then(|m| m.context_info.as_option()),
    ];
    contexts
        .into_iter()
        .flatten()
        .find_map(|c| c.stanza_id.clone())
        .filter(|id| !id.is_empty())
}

pub fn signal(message: &wa::Message) -> Option<Signal> {
    let b = message.get_base_message();
    if let Some(reaction) = b.reaction_message.as_option() {
        let target = reaction.key.as_option()?.id.clone()?;
        return Some(Signal::Reaction {
            target,
            emoji: reaction.text.clone().unwrap_or_default(),
        });
    }
    let protocol = b.protocol_message.as_option()?;
    let target = protocol.key.as_option()?.id.clone()?;
    use wa::message::protocol_message::Type;
    match protocol.r#type {
        Some(Type::REVOKE) => Some(Signal::Revoke { target }),
        Some(Type::MESSAGE_EDIT) => {
            let edited = protocol.edited_message.as_option()?;
            let text = edited.text_content().or_else(|| edited.get_caption())?.to_string();
            Some(Signal::Edit { target, text })
        }
        _ => None,
    }
}
