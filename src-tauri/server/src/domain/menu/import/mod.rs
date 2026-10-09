//! iFood import, pure parts: the converted tree shown as the preview, the converters for both
//! captured formats (consumer/legacy `data.menu[].itens[]` and Catalog v2 categories with
//! cross-referenced products/option groups/options), normalization to the catalog rules and counts.
mod json;
mod legacy;
mod normalize;
mod v2;
pub mod web;

pub use normalize::{group_key, normalize};

use super::model::Shift;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct ImportTree {
    pub pizza_pricing: String,
    pub categories: Vec<ImportCategory>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct ImportCategory {
    pub name: String,
    pub description: Option<String>,
    pub template: String,
    pub external_code: Option<String>,
    pub ifood_id: Option<String>,
    pub status: String,
    pub items: Vec<ImportItem>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct ImportItem {
    pub name: String,
    pub description: Option<String>,
    pub price_cents: i64,
    pub original_price_cents: Option<i64>,
    pub external_code: Option<String>,
    /// The product's own PDV code (v2 `products[].externalCode`).
    pub product_code: Option<String>,
    pub ifood_id: Option<String>,
    pub status: String,
    /// Absolute source URL of the photo.
    pub image_url: Option<String>,
    pub ean: Option<String>,
    pub serving: String,
    pub dietary: Vec<String>,
    pub shifts: Vec<Shift>,
    pub groups: Vec<ImportGroup>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct ImportGroup {
    pub name: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub min: i64,
    pub max: i64,
    pub external_code: Option<String>,
    pub ifood_id: Option<String>,
    pub status: String,
    pub options: Vec<ImportOption>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct ImportOption {
    pub name: String,
    pub description: Option<String>,
    pub price_cents: i64,
    pub original_price_cents: Option<i64>,
    pub external_code: Option<String>,
    pub ifood_id: Option<String>,
    pub status: String,
    pub max_quantity: i64,
    pub fractions: Option<Vec<i64>>,
    /// Topping price per size: `size` is the size option's `ifood_id` (or name).
    pub size_prices: Vec<ImportSizePrice>,
    pub image_url: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ImportSizePrice {
    pub size: String,
    pub price_cents: i64,
}

impl ImportOption {
    /// How toppings refer to this size option.
    pub fn key(&self) -> String {
        self.ifood_id.clone().unwrap_or_else(|| self.name.clone())
    }
}

/// Preview counts: categories, items, distinct groups and their options, distinct photos.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct ImportCounts {
    pub categories: i64,
    pub items: i64,
    pub groups: i64,
    pub options: i64,
    pub images: i64,
    /// Photos that could not be downloaded when the import was applied.
    pub images_failed: i64,
}

/// An import run: `starting` → `opening` → `waiting_human` → `loading` → `ready` → `applied`, or
/// `failed` (with `message`) / `cancelled`. `payload` keeps the captured JSON (never exposed).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct MenuImport {
    pub id: String,
    pub url: String,
    pub status: String,
    pub message: Option<String>,
    pub started_at: i64,
    pub finished_at: Option<i64>,
    #[serde(default)]
    pub counts: ImportCounts,
    pub preview: Option<ImportTree>,
    #[serde(skip_serializing, default)]
    pub payload: Value,
}

pub fn counts(tree: &ImportTree) -> ImportCounts {
    let items: Vec<&ImportItem> = tree.categories.iter().flat_map(|c| &c.items).collect();
    let mut groups = HashSet::new();
    let mut options = 0;
    let mut images = HashSet::new();
    for item in &items {
        images.extend(item.image_url.clone());
        for group in &item.groups {
            for option in &group.options {
                images.extend(option.image_url.clone());
            }
            if groups.insert(group_key(group)) {
                options += group.options.len() as i64;
            }
        }
    }
    ImportCounts {
        categories: tree.categories.len() as i64,
        items: items.len() as i64,
        groups: groups.len() as i64,
        options,
        images: images.len() as i64,
        images_failed: 0,
    }
}

/// The first captured payload (network responses or `__NEXT_DATA__`) that holds a non-empty menu in
/// either format, converted and normalized.
pub fn convert(payloads: &[Value]) -> Option<ImportTree> {
    payloads.iter().find_map(|payload| {
        let categories = legacy::find(payload)
            .map(|menu| legacy::convert(menu.as_slice()))
            .or_else(|| v2::find(payload).map(|(categories, pool)| v2::convert(categories, &pool)))?;
        let tree = normalize(ImportTree {
            pizza_pricing: "greater".into(),
            categories,
        });
        tree.categories.iter().any(|c| !c.items.is_empty()).then_some(tree)
    })
}
