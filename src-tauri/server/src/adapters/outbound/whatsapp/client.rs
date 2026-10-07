//! The WhatsApp port on whatsapp-rust: one Bot (and one device store `wa/<session>.db`) per session.
use super::describe::{decode, describe, from_context, from_history, Described, Origin};
use super::events::{qr_data_url, receipt_status};
use crate::adapters::outbound::sqlite::SqliteStore;
use crate::application::ports::{MirrorRepo, WhatsApp};
use crate::application::whatsapp_sink::{Arrival, WhatsAppEvents};
use crate::domain::error::{fail, Error, Result};
use crate::domain::model::{ChatUpdate, ConnectionDetail};
use async_trait::async_trait;
use parking_lot::Mutex;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, OnceLock};
use std::time::Duration;
use whatsapp_rust::prelude::*;

#[derive(Default)]
struct Entry {
    handle: Option<BotHandle>,
    client: Option<Arc<Client>>,
    qr: Option<String>,
    error: Option<String>,
}

pub struct Inner {
    dir: PathBuf,
    repo: Arc<SqliteStore>,
    sink: OnceLock<Arc<dyn WhatsAppEvents>>,
    sessions: Mutex<HashMap<String, Entry>>,
}

#[derive(Clone)]
pub struct WhatsAppClients(Arc<Inner>);

fn now() -> i64 {
    chrono::Utc::now().timestamp()
}

impl Inner {
    fn db(&self, id: &str) -> PathBuf {
        self.dir.join(format!("{id}.db"))
    }

    fn status(&self, id: &str, status: &str, phone: Option<&str>) {
        if let Some(sink) = self.sink.get() {
            sink.status(id, status, phone);
        }
    }

    fn deliver(&self, id: &str, described: Described, arrival: Arrival) {
        let Some(sink) = self.sink.get() else { return };
        let media = described.media.as_ref().map(|(meta, bytes)| (meta, bytes.as_slice()));
        sink.message(id, &described.message, media, arrival, now());
    }

    fn update(&self, id: &str, change: impl FnOnce(&mut Entry)) {
        if let Some(entry) = self.sessions.lock().get_mut(id) {
            change(entry);
        }
    }

    fn remove_files(&self, id: &str) {
        for suffix in ["", "-wal", "-shm"] {
            let _ = std::fs::remove_file(self.dir.join(format!("{id}.db{suffix}")));
        }
    }

    fn history(&self, id: &str, sync: &whatsapp_rust::types::events::LazyHistorySync) {
        let mut stream = sync.stream();
        while let Ok(Some(conversation)) = stream.next_conversation() {
            let name = conversation.name.clone().or(conversation.display_name.clone());
            let updated = conversation.conversation_timestamp.and_then(|t| i64::try_from(t).ok()).unwrap_or(0);
            if let Some(sink) = self.sink.get() {
                sink.chat(id, &ChatUpdate { jid: conversation.id.clone(), name, updated });
            }
            for item in &conversation.messages {
                if let Some(described) = item.message.as_option().and_then(from_history) {
                    self.deliver(id, described, Arrival::History);
                }
            }
        }
    }

    async fn on_event(self: Arc<Self>, id: String, event: Arc<Event>, client: Arc<Client>) {
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

impl WhatsAppClients {
    pub fn new(dir: PathBuf, repo: Arc<SqliteStore>) -> Self {
        let _ = std::fs::create_dir_all(&dir);
        Self(Arc::new(Inner { dir, repo, sink: OnceLock::new(), sessions: Mutex::new(HashMap::new()) }))
    }

    /// Connects the application sink (created after the port, in the composition root).
    pub fn attach(&self, sink: Arc<dyn WhatsAppEvents>) {
        let _ = self.0.sink.set(sink);
    }

    /// Reconnects every session that was paired before (its device store exists).
    pub async fn restore(&self) {
        for session in self.0.repo.sessions().unwrap_or_default() {
            if self.0.db(&session.id).exists() {
                let _ = self.connect(&session.id).await;
            }
        }
    }

    fn client(&self, id: &str) -> Option<Arc<Client>> {
        self.0.sessions.lock().get(id).and_then(|e| e.client.clone()).filter(|c| c.is_logged_in())
    }

    async fn start(&self, id: &str) -> Result<()> {
        let path = self.0.db(id).to_string_lossy().into_owned();
        let store = SqliteStore_::new(&path).await.map_err(Error::internal)?;
        let (inner, events, messages) = (self.0.clone(), id.to_string(), id.to_string());
        let bot = Bot::builder()
            .with_backend(store)
            .on_event(move |event, client| inner.clone().on_event(events.clone(), event, client))
            .on_message({
                let inner = self.0.clone();
                move |ctx: MessageContext| {
                    let (inner, id) = (inner.clone(), messages.clone());
                    async move {
                        if let Some(described) = from_context(&ctx.info, &ctx.message) {
                            let arrival = if described.message.from_me { Arrival::Append } else { Arrival::Notify };
                            inner.deliver(&id, described, arrival);
                        }
                    }
                }
            })
            .build()
            .await
            .map_err(Error::internal)?;
        let handle = bot.spawn();
        let client = handle.client();
        self.0.update(id, |e| {
            e.client = Some(client);
            e.handle = Some(handle);
        });
        Ok(())
    }
}

type SqliteStore_ = whatsapp_rust::store::SqliteStore;

#[async_trait]
impl WhatsApp for WhatsAppClients {
    async fn connect(&self, id: &str) -> Result<()> {
        if self.0.repo.session(id)?.is_none() {
            return fail("Sessão não encontrada");
        }
        {
            let mut sessions = self.0.sessions.lock();
            if sessions.contains_key(id) {
                return Ok(());
            }
            sessions.insert(id.into(), Entry::default());
        }
        self.0.status(id, "connecting", None);
        if let Err(error) = self.start(id).await {
            self.0.update(id, |e| e.error = Some("Não foi possível conectar ao WhatsApp. Tente novamente.".into()));
            self.0.status(id, "error", None);
            return Err(error);
        }
        Ok(())
    }

    async fn stop(&self, id: &str, logout: bool) -> Result<()> {
        let entry = self.0.sessions.lock().remove(id);
        if let Some(entry) = entry {
            if let (true, Some(client)) = (logout, entry.client.as_ref()) {
                let _ = tokio::time::timeout(Duration::from_secs(10), client.logout()).await;
            }
            if let Some(handle) = entry.handle {
                let _ = tokio::time::timeout(Duration::from_secs(10), handle.shutdown()).await;
            }
        }
        if logout {
            self.0.remove_files(id);
        }
        self.0.status(id, "disconnected", None);
        Ok(())
    }

    fn detail(&self, id: &str) -> ConnectionDetail {
        let sessions = self.0.sessions.lock();
        let entry = sessions.get(id);
        ConnectionDetail { qr: entry.and_then(|e| e.qr.clone()), error: entry.and_then(|e| e.error.clone()) }
    }

    async fn media(&self, id: &str, payload: &[u8]) -> Result<Vec<u8>> {
        let Some(client) = self.client(id) else {
            return fail("Conecte a sessão ao WhatsApp para baixar o anexo.");
        };
        let Some(message) = decode(payload) else {
            return fail("Anexo indisponível no histórico local.");
        };
        let download = async {
            if let Some(m) = message.image_message.as_option() {
                client.download(m).await
            } else if let Some(m) = message.video_message.as_option() {
                client.download(m).await
            } else if let Some(m) = message.audio_message.as_option() {
                client.download(m).await
            } else if let Some(m) = message.document_message.as_option() {
                client.download(m).await
            } else if let Some(m) = message.sticker_message.as_option() {
                client.download(m).await
            } else {
                Err(anyhow::anyhow!("no media"))
            }
        };
        match tokio::time::timeout(Duration::from_secs(30), download).await {
            Ok(Ok(bytes)) => Ok(bytes),
            Ok(Err(error)) => Err(Error::internal(error)),
            Err(_) => fail("O download demorou demais. Tente consultar o anexo novamente."),
        }
    }

    fn new_message_id(&self) -> String {
        let bytes = crate::application::crypto::random_bytes(9);
        format!("3EB0{}", hex::encode_upper(bytes))
    }

    async fn send(&self, id: &str, jid: &str, text: &str, message_id: Option<&str>) -> Result<String> {
        let Some(client) = self.client(id) else {
            return fail("Sessão desconectada");
        };
        let to: Jid = jid.parse().map_err(|_| Error::from(crate::domain::error::HelpdeskError::new("Conversa inválida")))?;
        let mut options = SendOptions::default();
        if let Some(message_id) = message_id {
            options = options.with_message_id(message_id.to_string());
        }
        let message = wa::Message { conversation: Some(text.into()), ..Default::default() };
        let sent = client.send_message_with_options(to, message.clone(), options).await.map_err(Error::internal)?;
        let origin = Origin { id: &sent.message_id, jid, alt: None, from_me: true, push: None, sender: jid, ts: now() };
        if let Some(described) = describe(origin, &message) {
            let _ = self.0.repo.store_message(id, &described.message, None);
        }
        Ok(sent.message_id)
    }
}
