//! Outbound adapters: SQLite, WhatsApp, webhook delivery, password hashing and the clock.
pub mod callback_address;
pub mod clock;
pub mod event_callback;
pub mod finance_mock;
pub mod image_fetcher;
pub mod llm;
pub mod media_storage;
pub mod opencode;
pub mod password;
pub mod secret_box;
pub mod sqlite;
pub mod webhook_sender;
pub mod whatsapp;
