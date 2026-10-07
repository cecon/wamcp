//! Entities exchanged between layers. Field names mirror the SQLite columns and the public JSON API.
mod catalog;
mod conversation;
mod inbox;
mod mirror;
mod people;

pub use catalog::*;
pub use conversation::*;
pub use inbox::*;
pub use mirror::*;
pub use people::*;

use serde::{Deserialize, Deserializer};

/// Distinguishes an absent field (`None`) from an explicit `null` (`Some(None)`) in request bodies.
pub fn nullable<'de, D, T>(deserializer: D) -> Result<Option<Option<T>>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(deserializer).map(Some)
}
