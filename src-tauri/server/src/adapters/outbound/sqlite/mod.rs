//! SQLite implementation of every repository port (same schema as the Node version).
mod automation;
mod catalog;
mod conversations;
mod db;
mod events;
mod inboxes;
mod insights;
mod migrations;
mod mirror;
mod teams;
mod users;

pub use db::SqliteStore;
