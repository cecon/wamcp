//! Building and sending WhatsApp messages: text, uploaded media (image, video, audio/voice note,
//! document, sticker), quotes, reactions, deletions, chat states and read receipts.
use crate::application::ports::{MessageRef, Quote, SendRequest, Typing};
use crate::domain::error::{Error, HelpdeskError, Result};
use crate::domain::model::OutgoingMedia;
use std::sync::Arc;
use whatsapp_rust::buffa::MessageField;
use whatsapp_rust::media::{self, AudioOptions, DocumentOptions, ImageOptions, VideoOptions};
use whatsapp_rust::prelude::*;
use whatsapp_rust::proto_helpers::build_quote_context;
use whatsapp_rust::wacore::download::MediaType;
use whatsapp_rust::{ChatStateType, RevokeType, UploadOptions};

pub fn jid(value: &str) -> Result<Jid> {
    value
        .parse()
        .map_err(|_| Error::from(HelpdeskError::new("Conversa inválida")))
}

fn upload_kind(media: &OutgoingMedia) -> MediaType {
    match media.file_type.as_str() {
        "image" => MediaType::Image,
        "video" => MediaType::Video,
        "audio" => MediaType::Audio,
        "sticker" => MediaType::Sticker,
        _ => MediaType::Document,
    }
}

async fn media_message(
    client: &Client,
    media: &OutgoingMedia,
    context: Option<wa::ContextInfo>,
) -> Result<wa::Message> {
    let up = client
        .upload(media.bytes.clone(), upload_kind(media), UploadOptions::default())
        .await
        .map_err(Error::internal)?;
    let context = context.map(Box::new);
    let mime = Some(media.mime_type.clone());
    let seconds = media.seconds.and_then(|s| u32::try_from(s).ok());
    Ok(match media.file_type.as_str() {
        "image" => media::image_message(
            up,
            ImageOptions {
                caption: media.caption.clone(),
                mimetype: mime,
                context_info: context,
                ..Default::default()
            },
        ),
        "video" => media::video_message(
            up,
            VideoOptions {
                caption: media.caption.clone(),
                mimetype: mime,
                duration_seconds: seconds,
                context_info: context,
                ..Default::default()
            },
        ),
        "audio" => {
            let ptt = media.voice.then_some(true);
            media::audio_message(
                up,
                AudioOptions {
                    mimetype: mime,
                    duration_seconds: seconds,
                    ptt,
                    context_info: context,
                    ..Default::default()
                },
            )
        }
        "sticker" => wa::Message {
            sticker_message: MessageField::some(wa::message::StickerMessage {
                url: Some(up.url.clone()),
                direct_path: Some(up.direct_path.clone()),
                media_key: Some(up.media_key.to_vec()),
                file_sha256: Some(up.file_sha256.to_vec()),
                file_enc_sha256: Some(up.file_enc_sha256.to_vec()),
                file_length: Some(up.file_length),
                media_key_timestamp: Some(up.media_key_timestamp),
                mimetype: mime,
                ..Default::default()
            }),
            ..Default::default()
        },
        _ => media::document_message(
            up,
            DocumentOptions {
                mimetype: mime,
                file_name: media.file_name.clone(),
                title: media.file_name.clone(),
                caption: media.caption.clone(),
                context_info: context,
                ..Default::default()
            },
        ),
    })
}

fn quote_context(quote: &Quote, own: Option<&Jid>, chat: &str) -> wa::ContextInfo {
    let sender = if quote.from_me {
        own.map(ToString::to_string).unwrap_or_default()
    } else {
        chat.to_string()
    };
    build_quote_context(quote.id.clone(), sender, &wa::Message::text(quote.text.clone()))
}

/// The WhatsApp message for a send request (uploading media first).
pub async fn build(client: &Arc<Client>, request: &SendRequest) -> Result<wa::Message> {
    let own = client.pn();
    let context = request
        .quote
        .as_ref()
        .map(|q| quote_context(q, own.as_ref(), &request.jid));
    if let Some(media) = &request.media {
        return media_message(client, media, context).await;
    }
    let text = request.text.clone().unwrap_or_default();
    Ok(match context {
        Some(context) => wa::Message::text_with_context(text, context),
        None => wa::Message {
            conversation: Some(text),
            ..Default::default()
        },
    })
}

pub async fn send(client: &Arc<Client>, request: &SendRequest) -> Result<(String, wa::Message)> {
    let message = build(client, request).await?;
    let mut options = SendOptions::default();
    if let Some(id) = &request.message_id {
        options = options.with_message_id(id.clone());
    }
    let sent = client
        .send_message_with_options(jid(&request.jid)?, message.clone(), options)
        .await
        .map_err(Error::internal)?;
    Ok((sent.message_id, message))
}

pub async fn react(client: &Arc<Client>, chat: &str, target: &MessageRef, emoji: &str) -> Result<()> {
    let key = wa::MessageKey {
        remote_jid: Some(chat.into()),
        from_me: Some(target.from_me),
        id: Some(target.id.clone()),
        participant: None,
    };
    client
        .send_reaction(jid(chat)?, key, emoji)
        .await
        .map(drop)
        .map_err(Error::internal)
}

pub async fn revoke(client: &Arc<Client>, chat: &str, message_id: &str) -> Result<()> {
    client
        .revoke_message(jid(chat)?, message_id.to_string(), RevokeType::Sender)
        .await
        .map_err(Error::internal)
}

pub async fn typing(client: &Arc<Client>, chat: &str, state: Typing) -> Result<()> {
    let kind = match state {
        Typing::Composing => ChatStateType::Composing,
        Typing::Recording => ChatStateType::Recording,
        Typing::Paused => ChatStateType::Paused,
    };
    client
        .chatstate()
        .send(&jid(chat)?, kind)
        .await
        .map_err(Error::internal)
}

pub async fn mark_read(client: &Arc<Client>, chat: &str, ids: &[String]) -> Result<()> {
    let ids: Vec<&str> = ids.iter().map(String::as_str).collect();
    client
        .mark_as_read(&jid(chat)?, None, &ids)
        .await
        .map_err(Error::internal)
}

pub async fn profile_picture(client: &Arc<Client>, chat: &str) -> Result<Option<String>> {
    let picture = client
        .contacts()
        .get_profile_picture(&jid(chat)?, false)
        .await
        .map_err(Error::internal)?;
    Ok(picture.map(|p| p.url))
}

pub async fn block(client: &Arc<Client>, chat: &str, blocked: bool) -> Result<()> {
    let target = jid(chat)?;
    let result = if blocked {
        client.blocking().block(&target).await
    } else {
        client.blocking().unblock(&target).await
    };
    result.map_err(Error::internal)
}
