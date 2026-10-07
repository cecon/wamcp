//! A controllable event callback for the events service tests.
use async_trait::async_trait;
use parking_lot::Mutex;
use serde_json::Value;
use std::collections::HashSet;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use tokio::sync::Semaphore;
use wamcp_server::application::ports::{CallbackError, CallbackResponse, EventCallback};

#[derive(Debug, Clone)]
pub struct Delivery {
    pub subscription: String,
    pub secrets: Vec<String>,
    pub event: Value,
}

/// A fake callback: records calls, optionally blocks on gates and answers with a set status
/// (`0` simulates a transport failure).
pub struct GateCallback {
    pub verified: Mutex<Vec<(String, String)>>,
    pub delivered: Mutex<Vec<Delivery>>,
    pub verify_error: Mutex<Option<String>>,
    pub status: Mutex<u16>,
    pub verify_gate: Mutex<Option<Arc<Semaphore>>>,
    pub deliver_gate: Mutex<Option<Arc<Semaphore>>>,
    /// When set, only deliveries to these subscription ids wait on the gate.
    pub gated: Mutex<Option<HashSet<String>>>,
    pub verifying: AtomicUsize,
    pub active: AtomicUsize,
    pub max_active: AtomicUsize,
}

impl Default for GateCallback {
    fn default() -> Self {
        Self {
            verified: Mutex::default(),
            delivered: Mutex::default(),
            verify_error: Mutex::default(),
            status: Mutex::new(204),
            verify_gate: Mutex::default(),
            deliver_gate: Mutex::default(),
            gated: Mutex::default(),
            verifying: AtomicUsize::new(0),
            active: AtomicUsize::new(0),
            max_active: AtomicUsize::new(0),
        }
    }
}

impl GateCallback {
    pub fn block_verify(&self) -> Arc<Semaphore> {
        let gate = Arc::new(Semaphore::new(0));
        *self.verify_gate.lock() = Some(gate.clone());
        gate
    }

    pub fn block_deliver(&self) -> Arc<Semaphore> {
        let gate = Arc::new(Semaphore::new(0));
        *self.deliver_gate.lock() = Some(gate.clone());
        gate
    }

    pub fn delivered(&self) -> Vec<Delivery> {
        self.delivered.lock().clone()
    }
}

#[async_trait]
impl EventCallback for GateCallback {
    async fn verify(&self, url: &str, _subscription: &str, secret: &str) -> Result<(), CallbackError> {
        self.verified.lock().push((url.into(), secret.into()));
        let gate = self.verify_gate.lock().clone();
        if let Some(gate) = gate {
            self.verifying.fetch_add(1, Ordering::SeqCst);
            gate.acquire().await.expect("gate open").forget();
        }
        match self.verify_error.lock().clone() {
            Some(reason) => Err(CallbackError { reason }),
            None => Ok(()),
        }
    }

    async fn deliver(
        &self,
        _url: &str,
        subscription: &str,
        secrets: &[String],
        event: &Value,
    ) -> Result<CallbackResponse, CallbackError> {
        let record = Delivery {
            subscription: subscription.into(),
            secrets: secrets.to_vec(),
            event: event.clone(),
        };
        self.delivered.lock().push(record);
        let gated = self.gated.lock().as_ref().is_none_or(|ids| ids.contains(subscription));
        let gate = self.deliver_gate.lock().clone().filter(|_| gated);
        if let Some(gate) = gate {
            let now = self.active.fetch_add(1, Ordering::SeqCst) + 1;
            self.max_active.fetch_max(now, Ordering::SeqCst);
            gate.acquire().await.expect("gate open").forget();
            self.active.fetch_sub(1, Ordering::SeqCst);
        }
        match *self.status.lock() {
            0 => Err(CallbackError {
                reason: "delivery_failed".into(),
            }),
            status => Ok(CallbackResponse {
                status,
                body: String::new(),
            }),
        }
    }
}
