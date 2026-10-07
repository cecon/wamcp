//! Ports: what the use cases need from the outside world. Adapters implement them.
mod catalog;
mod external;
mod mirror;
mod people;
mod support;

pub use catalog::*;
pub use external::*;
pub use mirror::*;
pub use people::*;
pub use support::*;

use crate::domain::error::Result;

/// Runs a unit of work atomically (all-or-nothing) on the repository.
pub trait Transactional {
    fn transaction_dyn(&self, work: &mut dyn FnMut() -> Result<()>) -> Result<()>;
}

/// The helpdesk repository: every aggregate store behind one handle.
pub trait Repository:
    UsersRepo
    + InboxRepo
    + ContactRepo
    + ConversationRepo
    + MessageRepo
    + CatalogRepo
    + AutomationRepo
    + InsightsRepo
    + MirrorRepo
    + OAuthRepo
    + EventRepo
    + Transactional
    + Send
    + Sync
{
}

impl<T> Repository for T where
    T: UsersRepo
        + InboxRepo
        + ContactRepo
        + ConversationRepo
        + MessageRepo
        + CatalogRepo
        + AutomationRepo
        + InsightsRepo
        + MirrorRepo
        + OAuthRepo
        + EventRepo
        + Transactional
        + Send
        + Sync
{
}

/// Typed wrapper over [`Transactional::transaction_dyn`].
pub fn transaction<T>(repo: &dyn Repository, work: impl FnOnce() -> Result<T>) -> Result<T> {
    let mut work = Some(work);
    let mut output = None;
    repo.transaction_dyn(&mut || {
        if let Some(work) = work.take() {
            output = Some(work()?);
        }
        Ok(())
    })?;
    output.ok_or_else(|| crate::domain::error::Error::internal("transaction produced no result"))
}
