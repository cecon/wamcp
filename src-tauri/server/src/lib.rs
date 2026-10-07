//! WA MCP backend: WhatsApp sessions, the Chatwoot-style helpdesk API, MCP and OAuth, served by Axum.
//!
//! Layers follow a hexagonal layout: `domain` (pure rules), `application` (use cases over ports) and
//! `adapters` (HTTP inbound, SQLite/WhatsApp/HTTP outbound). `compose` wires them together.
pub mod adapters;
pub mod application;
pub mod compose;
pub mod domain;
pub mod server;
