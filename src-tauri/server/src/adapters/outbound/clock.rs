//! Clocks: the system clock, and a settable one for tests and simulations.
use crate::application::ports::Clock;
use std::sync::atomic::{AtomicI64, Ordering};

#[derive(Default)]
pub struct SystemClock;

impl Clock for SystemClock {
    fn now_ms(&self) -> i64 {
        chrono::Utc::now().timestamp_millis()
    }
}

/// A clock that only moves when told to.
pub struct ManualClock(AtomicI64);

impl ManualClock {
    pub fn at(epoch_ms: i64) -> Self {
        Self(AtomicI64::new(epoch_ms))
    }

    pub fn set(&self, epoch_ms: i64) {
        self.0.store(epoch_ms, Ordering::SeqCst);
    }

    pub fn advance_secs(&self, seconds: i64) {
        self.0.fetch_add(seconds * 1000, Ordering::SeqCst);
    }
}

impl Clock for ManualClock {
    fn now_ms(&self) -> i64 {
        self.0.load(Ordering::SeqCst)
    }
}

impl ManualClock {
    pub fn now_secs(&self) -> i64 {
        self.now_ms().div_euclid(1000)
    }
}
