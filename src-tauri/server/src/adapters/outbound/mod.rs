//! Outbound adapters: SQLite, WhatsApp, webhook delivery, password hashing and the clock.
pub mod callback_address;
pub mod clock;
pub mod crawler;
pub mod event_callback;
pub mod image_fetcher;
pub mod media_storage;
pub mod password;
pub mod sqlite;
pub mod webhook_sender;
pub mod whatsapp;
