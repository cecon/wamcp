//! whatsapp-rust messages → the flat shape the application stores (`WaMessage`) plus media metadata
//! and the opaque payload (an encoded `WebMessageInfo` holding only the media) used to download it.
use crate::domain::model::{MediaMetadata, WaMessage};
use whatsapp_rust::buffa::{Message as _, MessageField};
use whatsapp_rust::prelude::*;

/// Baileys-compatible content type names (`getContentType`), so stored kinds stay the same.
pub fn content_type(message: &wa::Message) -> &'static str {
    let b = message.get_base_message();
    if b.conversation.as_deref().is_some_and(|s| !s.is_empty()) {
        return "conversation";
    }
    macro_rules! kinds {
        ($($field:ident => $name:literal),*) => { $( if b.$field.is_set() { return $name; } )* };
    }
    kinds!(extended_text_message => "extendedTextMessage", image_message => "imageMessage",
        video_message => "videoMessage", audio_message => "audioMessage", document_message => "documentMessage",
        sticker_message => "stickerMessage", ptv_message => "ptvMessage", contact_message => "contactMessage",
        contacts_array_message => "contactsArrayMessage", location_message => "locationMessage",
        live_location_message => "liveLocationMessage", reaction_message => "reactionMessage",
        protocol_message => "protocolMessage");
    "unknown"
}

/// Text shown for a message: its text, caption, document name, or `[kind]`.
pub fn body(message: &wa::Message, kind: &str) -> String {
    let b = message.get_base_message();
    let document = b.document_message.as_option().and_then(|d| d.file_name.clone());
    message
        .text_content()
        .map(String::from)
        .or_else(|| message.get_caption().map(String::from))
        .or(document)
        .unwrap_or_else(|| format!("[{}]", kind.trim_end_matches("Message")))
}

fn metadata(kind: &str, mime: Option<&String>, name: Option<&String>, size: Option<u64>, seconds: Option<u32>, voice: bool) -> MediaMetadata {
    MediaMetadata {
        kind: kind.into(),
        mime_type: mime.cloned().unwrap_or_else(|| "application/octet-stream".into()),
        file_name: name.cloned(),
        size: size.and_then(|s| i64::try_from(s).ok()),
        duration: seconds.map(i64::from),
        voice,
    }
}

/// Media metadata and the download payload, when the message carries media.
pub fn media(jid: &str, id: &str, from_me: bool, message: &wa::Message) -> Option<(MediaMetadata, Vec<u8>)> {
    let b = message.get_base_message();
    let mut only = wa::Message::default();
    let meta = if let Some(m) = b.image_message.as_option() {
        only.image_message = MessageField::some(m.clone());
        metadata("image", m.mimetype.as_ref(), None, m.file_length, None, false)
    } else if let Some(m) = b.video_message.as_option() {
        only.video_message = MessageField::some(m.clone());
        metadata("video", m.mimetype.as_ref(), None, m.file_length, m.seconds, false)
    } else if let Some(m) = b.audio_message.as_option() {
        only.audio_message = MessageField::some(m.clone());
        metadata("audio", m.mimetype.as_ref(), None, m.file_length, m.seconds, m.ptt.unwrap_or(false))
    } else if let Some(m) = b.document_message.as_option() {
        only.document_message = MessageField::some(m.clone());
        metadata("document", m.mimetype.as_ref(), m.file_name.as_ref(), m.file_length, None, false)
    } else if let Some(m) = b.sticker_message.as_option() {
        only.sticker_message = MessageField::some(m.clone());
        metadata("sticker", m.mimetype.as_ref(), None, m.file_length, None, false)
    } else {
        return None;
    };
    let key = wa::MessageKey {
        remote_jid: Some(jid.into()),
        from_me: Some(from_me),
        id: Some(id.into()),
        ..Default::default()
    };
    let info = wa::WebMessageInfo { key: MessageField::some(key), message: MessageField::some(only), ..Default::default() };
    Some((meta, info.encode_to_vec()))
}

pub struct Described {
    pub message: WaMessage,
    pub media: Option<(MediaMetadata, Vec<u8>)>,
}

/// Where a message comes from: its id, chat, author and time.
pub struct Origin<'a> {
    pub id: &'a str,
    pub jid: &'a str,
    pub alt: Option<String>,
    pub from_me: bool,
    pub push: Option<&'a str>,
    pub sender: &'a str,
    pub ts: i64,
}

/// Describes a message; `None` for status broadcasts and messages without content.
pub fn describe(origin: Origin, message: &wa::Message) -> Option<Described> {
    let Origin { id, jid, alt, from_me, push, sender, ts } = origin;
    if id.is_empty() || jid.is_empty() || jid == "status@broadcast" {
        return None;
    }
    let kind = content_type(message);
    let push = push.filter(|p| !p.is_empty());
    let described = WaMessage {
        id: id.into(),
        jid: jid.into(),
        alt_jid: alt,
        from_me,
        sender: push.unwrap_or(sender).to_string(),
        push_name: if from_me { None } else { push.map(String::from) },
        body: body(message, kind),
        kind: kind.into(),
        ts,
    };
    Some(Described { media: media(jid, id, from_me, message), message: described })
}

/// A live message delivered to `on_message`.
pub fn from_context(info: &MessageInfo, message: &wa::Message) -> Option<Described> {
    let source = &info.source;
    let alt = source.sender_alt.as_ref().filter(|_| !source.is_group).map(ToString::to_string);
    let push = Some(info.push_name.as_str());
    let sender = source.sender.to_string();
    let chat = source.chat.to_string();
    let origin = Origin { id: &info.id, jid: &chat, alt, from_me: source.is_from_me, push, sender: &sender, ts: info.timestamp.timestamp() };
    describe(origin, message)
}

/// A message from a history sync chunk.
pub fn from_history(info: &wa::WebMessageInfo) -> Option<Described> {
    let key = info.key.as_option()?;
    let message = info.message.as_option()?;
    let jid = key.remote_jid.clone().unwrap_or_default();
    let sender = key.participant.clone().unwrap_or_else(|| jid.clone());
    let ts = info.message_timestamp.and_then(|t| i64::try_from(t).ok()).unwrap_or_default();
    let id = key.id.clone().unwrap_or_default();
    let from_me = key.from_me.unwrap_or(false);
    let origin = Origin { id: &id, jid: &jid, alt: None, from_me, push: info.push_name.as_deref(), sender: &sender, ts };
    describe(origin, message)
}

/// Decodes a stored payload (also the ones written by the former Baileys backend) for download.
pub fn decode(payload: &[u8]) -> Option<wa::Message> {
    let info = whatsapp_rust::waproto::codec::web_message_info_decode(payload).ok()?;
    info.message.into_option().map(|m| m.get_base_message().clone())
}
