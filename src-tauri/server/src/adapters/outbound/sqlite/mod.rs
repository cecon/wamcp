//! SQLite implementation of every repository port (same schema as the Node version).
mod account;
mod attachments;
mod automation;
mod catalog;
mod contact_book;
mod contacts;
mod conversations;
mod custom;
mod db;
mod events;
mod filters;
mod inboxes;
mod insights;
mod macros;
mod messages;
mod migrations;
mod mirror;
mod notifications;
mod reports;
mod schema;
mod search;
mod security;
mod sla;
mod teams;
mod users;

pub use db::SqliteStore;
