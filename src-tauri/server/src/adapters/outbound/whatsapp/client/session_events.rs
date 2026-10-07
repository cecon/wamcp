//! Connection events of one session: QR, connected/disconnected, logout, receipts and history sync.
use super::super::describe::from_context;
use super::super::describe::from_history;
use super::super::events::{qr_data_url, receipt_status};
use super::super::signals::{self, Signal};
use super::Inner;
use crate::application::ports::Typing;
use crate::application::whatsapp_sink::Arrival;
use crate::domain::model::ChatUpdate;
use std::sync::Arc;
use whatsapp_rust::prelude::*;

impl Inner {
    /// A live message: stored and routed, then its quote, reaction, deletion or edit applied.
    pub(super) fn receive(&self, id: &str, ctx: &MessageContext) {
        let (chat, message_id) = (ctx.info.source.chat.to_string(), ctx.info.id.clone());
        if let Some(described) = from_context(&ctx.info, &ctx.message) {
            let arrival = if described.message.from_me {
                Arrival::Append
            } else {
                Arrival::Notify
            };
            self.deliver(id, described, arrival);
        }
        let Some(sink) = self.sink.get() else { return };
        if let Some(quoted) = signals::quoted_id(&ctx.message) {
            sink.quoted(id, &message_id, &quoted);
        }
        match signals::signal(&ctx.message) {
            Some(Signal::Reaction { target, emoji }) => {
                sink.reaction(id, &chat, ctx.info.source.is_from_me, &target, &emoji)
            }
            Some(Signal::Revoke { target }) => sink.revoked(id, &target),
            Some(Signal::Edit { target, text }) => sink.edited(id, &target, &text),
            None => {}
        }
    }

    fn history(&self, id: &str, sync: &whatsapp_rust::types::events::LazyHistorySync) {
        let mut stream = sync.stream();
        while let Ok(Some(conversation)) = stream.next_conversation() {
            let name = conversation.name.clone().or(conversation.display_name.clone());
            let updated = conversation
                .conversation_timestamp
                .and_then(|t| i64::try_from(t).ok())
                .unwrap_or(0);
            if let Some(sink) = self.sink.get() {
                sink.chat(
                    id,
                    &ChatUpdate {
                        jid: conversation.id.clone(),
                        name,
                        updated,
                    },
                );
            }
            for item in &conversation.messages {
                if let Some(described) = item.message.as_option().and_then(from_history) {
                    self.deliver(id, described, Arrival::History);
                }
            }
        }
    }

    pub(super) async fn on_event(self: Arc<Self>, id: String, event: Arc<Event>, client: Arc<Client>) {
        match &*event {
            Event::PairingQrCode(qr) => {
                self.update(&id, |e| e.qr = qr_data_url(&qr.code));
                self.status(&id, "qr", None);
            }
            Event::Connected(_) => {
                self.update(&id, |e| e.qr = None);
                let phone = client.pn().map(|j| j.user.to_string());
                self.status(&id, "connected", phone.as_deref());
            }
            Event::Disconnected(_) => self.status(&id, "reconnecting", None),
            Event::StreamReplaced(_) => self.status(&id, "disconnected", None),
            Event::PairingQrCodesExhausted(_) => {
                self.sessions.lock().remove(&id);
                self.status(&id, "disconnected", None);
            }
            Event::LoggedOut(_) => {
                if let Some(sink) = self.sink.get() {
                    sink.logged_out(&id);
                }
                if let Some(entry) = self.sessions.lock().remove(&id) {
                    if let Some(handle) = entry.handle {
                        handle.abort();
                    }
                }
                self.remove_files(&id);
            }
            Event::ChatPresence(update) => {
                use whatsapp_rust::types::presence::{ChatPresence, ChatPresenceMedia};
                let state = match (&update.state, &update.media) {
                    (ChatPresence::Composing, ChatPresenceMedia::Audio) => Typing::Recording,
                    (ChatPresence::Composing, _) => Typing::Composing,
                    _ => Typing::Paused,
                };
                if let Some(sink) = self.sink.get() {
                    sink.typing(&id, &update.source.chat.to_string(), state);
                }
            }
            Event::Receipt(receipt) => {
                if let (Some(status), Some(sink)) = (receipt_status(&receipt.r#type), self.sink.get()) {
                    for message in &receipt.message_ids {
                        sink.receipt(&id, message, status);
                    }
                }
            }
            Event::HistorySync(sync) => {
                let (inner, sync) = (self.clone(), sync.clone());
                let _ = tokio::task::spawn_blocking(move || inner.history(&id, &sync)).await;
            }
            _ => {}
        }
    }
}
