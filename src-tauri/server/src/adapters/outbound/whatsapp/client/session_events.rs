//! Connection events of one session: QR, connected/disconnected, logout, receipts and history sync.
use super::super::describe::from_history;
use super::super::events::{qr_data_url, receipt_status};
use super::Inner;
use crate::application::whatsapp_sink::Arrival;
use crate::domain::model::ChatUpdate;
use std::sync::Arc;
use whatsapp_rust::prelude::*;

impl Inner {
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
