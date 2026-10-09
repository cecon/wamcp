//! In-process event dispatcher (Chatwoot's dispatcher/listeners). Listeners such as SSE, webhooks and
//! notifications subscribe here; a failing listener never breaks the use case that emitted the event.
use crate::domain::actor::Performer;
use futures::future::BoxFuture;
use parking_lot::RwLock;
use serde::Serialize;
use serde_json::Value;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::Arc;
use tokio::sync::{mpsc, Notify};

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Envelope {
    pub event: String,
    pub data: Value,
    pub performer: Performer,
    pub at: i64,
}

type Listener = Arc<dyn Fn(&Envelope) + Send + Sync>;

#[derive(Default)]
pub struct EventBus {
    listeners: RwLock<Vec<(u64, Listener)>>,
    next: AtomicU64,
}

impl EventBus {
    pub fn subscribe(&self, listener: impl Fn(&Envelope) + Send + Sync + 'static) -> u64 {
        let id = self.next.fetch_add(1, Ordering::Relaxed);
        self.listeners.write().push((id, Arc::new(listener)));
        id
    }

    pub fn unsubscribe(&self, id: u64) {
        self.listeners.write().retain(|(key, _)| *key != id);
    }

    pub fn emit(&self, event: &str, data: Value, performer: Performer) {
        let envelope = Envelope {
            event: event.into(),
            data,
            performer,
            at: chrono::Utc::now().timestamp_millis(),
        };
        // Listeners may emit in turn, so iterate over a snapshot without holding the lock.
        let listeners: Vec<Listener> = self.listeners.read().iter().map(|(_, l)| l.clone()).collect();
        for listener in listeners {
            // Listener failures are isolated by design.
            let _ = catch_unwind(AssertUnwindSafe(|| listener(&envelope)));
        }
    }
}

type Handler = Arc<dyn Fn(Envelope) -> BoxFuture<'static, ()> + Send + Sync>;

/// Runs async listeners (automations, auto-replies) one event at a time, in order, after the
/// triggering commit — like the promise queues of the Node implementation.
#[derive(Clone)]
pub struct Worker {
    sender: mpsc::UnboundedSender<Envelope>,
    pending: Arc<AtomicUsize>,
    idle: Arc<Notify>,
}

impl Worker {
    pub fn spawn(handler: Handler) -> Self {
        let (sender, mut receiver) = mpsc::unbounded_channel::<Envelope>();
        let pending = Arc::new(AtomicUsize::new(0));
        let idle = Arc::new(Notify::new());
        let (count, notify) = (pending.clone(), idle.clone());
        tokio::spawn(async move {
            while let Some(envelope) = receiver.recv().await {
                let task = tokio::spawn(handler(envelope));
                let _ = task.await;
                if count.fetch_sub(1, Ordering::AcqRel) == 1 {
                    notify.notify_waiters();
                }
            }
        });
        Self { sender, pending, idle }
    }

    pub fn push(&self, envelope: &Envelope) {
        self.pending.fetch_add(1, Ordering::AcqRel);
        if self.sender.send(envelope.clone()).is_err() {
            self.pending.fetch_sub(1, Ordering::AcqRel);
        }
    }

    pub fn is_idle(&self) -> bool {
        self.pending.load(Ordering::Acquire) == 0
    }

    /// Waits until the queue is empty (used by tests and graceful shutdown).
    pub async fn settle(&self) {
        while !self.is_idle() {
            let notified = self.idle.notified();
            if self.is_idle() {
                break;
            }
            let _ = tokio::time::timeout(std::time::Duration::from_millis(50), notified).await;
        }
    }
}
