//! Product catalog (the store's menu, `/catalog` in the API): categories, items, reusable groups of
//! options with min/max, pizza and combo rules, availability by shift, the order quote calculator and
//! the iFood importer's pure parts. Named `menu` in code because `catalog` already holds labels and
//! canned responses. Prices are integer cents.
pub mod assemble;
pub mod availability;
pub mod images;
pub mod import;
pub mod model;
pub mod money;
pub mod patch;
pub mod pizza;
pub mod quote;
pub mod rules;
pub mod search;

pub use model::*;
