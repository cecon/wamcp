//! SQLite implementation of every repository port (same schema as the Node version).
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
mod messages;
mod migrations;
mod mirror;
mod notifications;
mod schema;
mod teams;
mod users;

pub use db::SqliteStore;
