//! MCP events: `message.created` webhook subscriptions with callback verification, a durable
//! per-subscription queue, retries with backoff and secret rotation.
use super::crypto::sha256_hex;
use super::ports::{Clock, EventCallback, Repository, Subscription};
use crate::domain::events::{
    event_definition, event_parameters, iso_millis, subscription_identity, validate_owner, EventError, EventOwner,
    EventParams, EVENT_NAME, ROTATION_WINDOW,
};
use parking_lot::Mutex;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;

mod delivery;

type Authorize = Arc<dyn Fn(&EventOwner) -> bool + Send + Sync>;
const MAX_OPERATIONS: usize = 256;

pub struct EventState {
    pub repo: Arc<dyn Repository>,
    pub callback: Arc<dyn EventCallback>,
    pub clock: Arc<dyn Clock>,
    pub authorize: Authorize,
    locks: Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>,
    verified: Mutex<HashMap<String, i64>>,
    disconnected: Mutex<HashMap<String, u64>>,
    operations: AtomicUsize,
    closed: AtomicBool,
    flushing: tokio::sync::Mutex<()>,
}

#[derive(Clone)]
pub struct EventService(pub Arc<EventState>);

/// Internal failures stay generic; business limits (e.g. too many subscriptions) are explained.
fn unavailable(error: crate::domain::error::Error) -> EventError {
    match error {
        crate::domain::error::Error::Helpdesk(e) => EventError::coded(&e.message, -32603),
        crate::domain::error::Error::Internal(_) => {
            EventError::coded("Não foi possível concluir a operação de evento", -32603)
        }
    }
}

fn revoked() -> EventError {
    EventError::coded("Acesso ao evento revogado ou expirado", -32001)
}

pub fn owner_of(subscription: &Subscription) -> EventOwner {
    EventOwner {
        session_id: subscription.session_id.clone(),
        principal_id: subscription.principal_id.clone(),
        principal_kind: subscription.principal_kind.clone(),
    }
}

impl EventService {
    pub fn new(
        repo: Arc<dyn Repository>,
        callback: Arc<dyn EventCallback>,
        clock: Arc<dyn Clock>,
        authorize: Authorize,
    ) -> Self {
        Self(Arc::new(EventState {
            repo,
            callback,
            clock,
            authorize,
            locks: Mutex::default(),
            verified: Mutex::default(),
            disconnected: Mutex::default(),
            operations: AtomicUsize::new(0),
            closed: AtomicBool::new(false),
            flushing: tokio::sync::Mutex::new(()),
        }))
    }

    fn now(&self) -> i64 {
        self.0.clock.now_ms()
    }

    fn allowed(&self, owner: &EventOwner) -> bool {
        (self.0.authorize)(owner)
    }

    fn require_access(&self, owner: &EventOwner) -> Result<(), EventError> {
        if self.0.closed.load(Ordering::Acquire) || !self.allowed(owner) {
            return Err(revoked());
        }
        Ok(())
    }

    /// Runs operations on the same subscription one at a time.
    async fn serial<T>(
        &self,
        id: &str,
        operation: impl std::future::Future<Output = Result<T, EventError>>,
    ) -> Result<T, EventError> {
        if self.0.operations.fetch_add(1, Ordering::AcqRel) >= MAX_OPERATIONS {
            self.0.operations.fetch_sub(1, Ordering::AcqRel);
            return Err(EventError::coded("Muitas operações de eventos simultâneas", -32000));
        }
        let lock = self.0.locks.lock().entry(id.to_string()).or_default().clone();
        let result = {
            let _guard = lock.lock().await;
            operation.await
        };
        self.0.operations.fetch_sub(1, Ordering::AcqRel);
        let mut locks = self.0.locks.lock();
        if locks.get(id).is_some_and(|l| Arc::strong_count(l) <= 2) {
            locks.remove(id);
        }
        result
    }

    fn prune(&self) -> crate::domain::error::Result<()> {
        let now = self.now();
        self.0.repo.prune_events(now)?;
        for subscription in self.0.repo.subscriptions(None)? {
            if !self.allowed(&owner_of(&subscription)) {
                self.0.repo.remove_subscription(&subscription.id)?;
            }
        }
        self.0.verified.lock().retain(|_, expires| *expires > now);
        Ok(())
    }

    async fn verify(&self, subscription: &Subscription, force: bool) -> Result<(), EventError> {
        let key = sha256_hex(
            &json!([
                subscription.session_id,
                subscription.principal_kind,
                subscription.principal_id,
                subscription.url,
                subscription.secret
            ])
            .to_string(),
        );
        if !force && self.0.verified.lock().get(&key).is_some_and(|e| *e > self.now()) {
            return Ok(());
        }
        let checked = self
            .0
            .callback
            .verify(&subscription.url, &subscription.id, &subscription.secret)
            .await;
        if let Err(error) = checked {
            let known = ["invalid_url", "timeout", "challenge_failed"].contains(&error.reason.as_str());
            return Err(EventError::callback(if known {
                &error.reason
            } else {
                "challenge_failed"
            }));
        }
        let mut verified = self.0.verified.lock();
        if verified.len() >= 256 {
            if let Some(oldest) = verified.keys().next().cloned() {
                verified.remove(&oldest);
            }
        }
        verified.insert(key, self.now() + ROTATION_WINDOW);
        Ok(())
    }

    pub fn list(&self) -> Value {
        json!({ "events": [event_definition()] })
    }

    fn identity(owner: &EventOwner, params: &EventParams) -> String {
        format!("sub_{}", sha256_hex(&subscription_identity(owner, params)))
    }

    pub async fn subscribe(&self, owner: EventOwner, params: &Value) -> Result<Value, EventError> {
        validate_owner(&owner)?;
        let parsed = event_parameters(params, true)?;
        let id = Self::identity(&owner, &parsed);
        let generation = self.0.disconnected.lock().get(&owner.session_id).copied();
        self.serial(&id.clone(), async {
            self.require_access(&owner)?;
            self.prune().map_err(unavailable)?;
            let current = self.0.repo.subscription(&id).map_err(unavailable)?;
            let ttl = parsed.ttl.unwrap_or_default();
            let secret = parsed.secret.clone().unwrap_or_default();
            let mut subscription = Subscription {
                session_id: owner.session_id.clone(),
                principal_id: owner.principal_id.clone(),
                principal_kind: owner.principal_kind.clone(),
                id: id.clone(),
                name: EVENT_NAME.into(),
                args: parsed.args.clone(),
                url: parsed.url.clone(),
                secret: secret.clone(),
                expires: self.now() + ttl,
                previous_secret: None,
                rotate_until: None,
            };
            let rotated = current.as_ref().is_some_and(|c| c.secret != secret);
            if let Some(current) = current.as_ref() {
                if rotated {
                    subscription.previous_secret = Some(current.secret.clone());
                    subscription.rotate_until = Some(self.now() + ROTATION_WINDOW);
                } else if current.rotate_until.is_some_and(|until| until > self.now()) {
                    subscription.previous_secret = current.previous_secret.clone();
                    subscription.rotate_until = current.rotate_until;
                }
            }
            self.verify(&subscription, rotated).await?;
            self.require_access(&owner)?;
            if self.0.disconnected.lock().get(&owner.session_id).copied() != generation {
                return Err(EventError::coded("Sessão desconectada durante a verificação", -32001));
            }
            subscription.expires = self.now() + ttl;
            self.0.repo.save_subscription(&subscription).map_err(unavailable)?;
            Ok(json!({ "id": id, "refreshBefore": iso_millis(subscription.expires), "cursor": null, "truncated": false }))
        })
        .await
    }

    pub async fn unsubscribe(&self, owner: EventOwner, params: &Value) -> Result<Value, EventError> {
        validate_owner(&owner)?;
        let parsed = event_parameters(params, false)?;
        let id = Self::identity(&owner, &parsed);
        self.serial(&id.clone(), async {
            self.require_access(&owner)?;
            self.0.repo.remove_subscription(&id).map_err(unavailable)?;
            Ok(json!({}))
        })
        .await
    }

    /// Drops every subscription of a session that logged out or was stopped.
    pub fn disconnect(&self, session_id: &str) -> crate::domain::error::Result<()> {
        *self.0.disconnected.lock().entry(session_id.into()).or_default() += 1;
        self.0.repo.remove_session_subscriptions(session_id)
    }

    pub fn close(&self) {
        self.0.closed.store(true, Ordering::Release);
        self.0.verified.lock().clear();
    }
}
