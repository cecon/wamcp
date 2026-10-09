//! Item search (name, description and PDV codes, ignoring case and accents) and list filters.
use super::model::{ItemView, Menu};
use super::rules::fold;

pub const SEARCH_LIMIT: usize = 20;

/// Whether every word of `query` appears in the item's name, description or codes.
pub fn matches(item: &ItemView, query: &str) -> bool {
    let haystack = fold(&format!(
        "{} {} {} {}",
        item.product.name,
        item.product.description.as_deref().unwrap_or_default(),
        item.item.external_code.as_deref().unwrap_or_default(),
        item.product.external_code.as_deref().unwrap_or_default(),
    ));
    fold(query).split_whitespace().all(|word| haystack.contains(word))
}

/// Items filtered by category, text and status, in menu order.
pub fn filter<'a>(
    menu: &'a Menu,
    category_id: Option<i64>,
    query: Option<&str>,
    status: Option<&str>,
) -> Vec<&'a ItemView> {
    menu.items()
        .filter(|i| category_id.is_none_or(|c| i.item.category_id == c))
        .filter(|i| query.is_none_or(|q| matches(i, q)))
        .filter(|i| status.is_none_or(|s| i.item.status == s))
        .collect()
}

/// Up to 20 matches; names that start with the query come first.
pub fn search<'a>(menu: &'a Menu, query: &str, only_available: bool) -> Vec<&'a ItemView> {
    let folded = fold(query);
    let mut found: Vec<&ItemView> = menu
        .items()
        .filter(|i| !only_available || i.available_now)
        .filter(|i| matches(i, query))
        .collect();
    found.sort_by_key(|i| !fold(&i.product.name).starts_with(&folded));
    found.truncate(SEARCH_LIMIT);
    found
}
