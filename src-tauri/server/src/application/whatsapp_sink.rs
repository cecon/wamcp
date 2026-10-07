//! WhatsApp → application: what the connection adapter reports (status, chats, messages, receipts,
//! logout) is mirrored locally and routed to the helpdesk and to MCP event subscribers.
use super::events::EventService;
use super::helpdesk::HelpdeskService;
use super::ports::Repository;
use crate::domain::model::{ChatUpdate, MediaMetadata, WaMessage};
use std::sync::Arc;

/// Live messages older than this (e.g. replayed after a long outage) stay in the mirror only.
pub const LIVE_WINDOW_SECONDS: i64 = 2 * 86_400;
/// Protocol and control messages never start a support conversation or an MCP event.
const CONTROL_KINDS: [&str; 4] = ["protocolMessage", "reactionMessage", "senderKeyDistributionMessage", "unknown"];

/// How a message reached us: history sync, a new message, or an echo of one we (or the phone) sent.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Arrival {
    History,
    Notify,
    Append,
}

/// The inbound port of WhatsApp connection adapters.
pub trait WhatsAppEvents: Send + Sync {
    fn status(&self, session_id: &str, status: &str, phone: Option<&str>);
    fn chat(&self, session_id: &str, chat: &ChatUpdate);
    fn message(&self, session_id: &str, message: &WaMessage, media: Option<(&MediaMetadata, &[u8])>, arrival: Arrival, now: i64);
    fn receipt(&self, session_id: &str, message_id: &str, status: &str);
    fn logged_out(&self, session_id: &str);
}

pub struct WhatsAppSink {
    pub repo: Arc<dyn Repository>,
    pub helpdesk: Option<HelpdeskService>,
    pub events: Option<EventService>,
}

impl WhatsAppEvents for WhatsAppSink {
    fn status(&self, session_id: &str, status: &str, phone: Option<&str>) {
        let _ = self.repo.set_status(session_id, status, phone);
    }

    fn chat(&self, session_id: &str, chat: &ChatUpdate) {
        let _ = self.repo.upsert_chat(session_id, chat);
    }

    fn message(&self, session_id: &str, message: &WaMessage, media: Option<(&MediaMetadata, &[u8])>, arrival: Arrival, now: i64) {
        let stored = self.repo.store_message(session_id, message, media).unwrap_or(false);
        if !stored || CONTROL_KINDS.contains(&message.kind.as_str()) {
            return;
        }
        if arrival == Arrival::Notify && !message.from_me {
            if let Some(events) = &self.events {
                events.publish(session_id, message);
            }
        }
        let live = arrival == Arrival::Notify || (arrival == Arrival::Append && message.from_me);
        if live && message.ts > now - LIVE_WINDOW_SECONDS {
            if let Some(helpdesk) = &self.helpdesk {
                if let Err(error) = helpdesk.ingest(session_id, message) {
                    tracing::warn!("helpdesk ingestion failed: {error}");
                }
            }
        }
    }

    fn receipt(&self, session_id: &str, message_id: &str, status: &str) {
        if let Some(helpdesk) = &self.helpdesk {
            let _ = helpdesk.receipt(session_id, message_id, status);
        }
    }

    fn logged_out(&self, session_id: &str) {
        if let Some(events) = &self.events {
            let _ = events.disconnect(session_id);
        }
        let _ = self.repo.set_status(session_id, "logged_out", None);
    }
}
