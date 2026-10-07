//! WhatsApp port implementations.
#[cfg(feature = "whatsapp")]
pub mod client;
#[cfg(feature = "whatsapp")]
pub mod describe;
pub mod events;
pub mod memory;
