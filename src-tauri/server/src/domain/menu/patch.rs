//! Request bodies for creating and editing catalog entries. Creation applies the body over defaults,
//! edits over the stored row; absent fields are kept and `null` clears nullable ones. Text is trimmed
//! and blank optional text becomes `null`. The result is then validated as a whole by `rules`.
use super::model::{Category, Group, Item, Link, MenuOption, MenuSettings, Product, Shift, SizePrice};
use crate::domain::model::nullable;
use serde::Deserialize;

fn clean(value: &Option<Option<String>>, target: &mut Option<String>) {
    if let Some(value) = value {
        *target = value
            .as_deref()
            .map(str::trim)
            .filter(|v| !v.is_empty())
            .map(String::from);
    }
}

fn set<T: Clone>(value: &Option<T>, target: &mut T) {
    if let Some(value) = value {
        *target = value.clone();
    }
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct ProductPatch {
    pub name: Option<String>,
    #[serde(default, deserialize_with = "nullable")]
    pub description: Option<Option<String>>,
    #[serde(default, deserialize_with = "nullable")]
    pub external_code: Option<Option<String>>,
    #[serde(default, deserialize_with = "nullable")]
    pub ean: Option<Option<String>>,
    pub serving: Option<String>,
    pub dietary: Option<Vec<String>>,
    #[serde(default, deserialize_with = "nullable")]
    pub slices: Option<Option<i64>>,
}

impl ProductPatch {
    pub fn apply(&self, product: &mut Product) {
        if let Some(name) = &self.name {
            product.name = name.trim().into();
        }
        clean(&self.description, &mut product.description);
        clean(&self.external_code, &mut product.external_code);
        clean(&self.ean, &mut product.ean);
        set(&self.serving, &mut product.serving);
        set(&self.dietary, &mut product.dietary);
        set(&self.slices, &mut product.slices);
    }
}

pub fn new_product() -> Product {
    Product {
        serving: "not_applicable".into(),
        ..Product::default()
    }
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct CategoryPatch {
    pub name: Option<String>,
    #[serde(default, deserialize_with = "nullable")]
    pub description: Option<Option<String>>,
    pub template: Option<String>,
    #[serde(default, deserialize_with = "nullable")]
    pub external_code: Option<Option<String>>,
    pub status: Option<String>,
    pub position: Option<i64>,
}

impl CategoryPatch {
    pub fn apply(&self, category: &mut Category) {
        if let Some(name) = &self.name {
            category.name = name.trim().into();
        }
        clean(&self.description, &mut category.description);
        set(&self.template, &mut category.template);
        clean(&self.external_code, &mut category.external_code);
        set(&self.status, &mut category.status);
        set(&self.position, &mut category.position);
    }
}

pub fn new_category() -> Category {
    Category {
        template: "default".into(),
        status: "available".into(),
        ..Category::default()
    }
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct ItemPatch {
    /// Must match the category template when sent (the type always follows the category).
    #[serde(rename = "type")]
    pub kind: Option<String>,
    pub category_id: Option<i64>,
    pub price_cents: Option<i64>,
    #[serde(default, deserialize_with = "nullable")]
    pub original_price_cents: Option<Option<i64>>,
    pub status: Option<String>,
    #[serde(default, deserialize_with = "nullable")]
    pub external_code: Option<Option<String>>,
    pub shifts: Option<Vec<Shift>>,
    pub position: Option<i64>,
    pub product: Option<ProductPatch>,
    pub groups: Option<Vec<Link>>,
}

impl ItemPatch {
    /// Applies the item fields (the product and the group links are handled by the caller).
    pub fn apply(&self, item: &mut Item) {
        set(&self.category_id, &mut item.category_id);
        set(&self.price_cents, &mut item.price_cents);
        set(&self.original_price_cents, &mut item.original_price_cents);
        set(&self.status, &mut item.status);
        clean(&self.external_code, &mut item.external_code);
        set(&self.shifts, &mut item.shifts);
        set(&self.position, &mut item.position);
    }
}

pub fn new_item() -> Item {
    Item {
        kind: "default".into(),
        status: "available".into(),
        ..Item::default()
    }
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct OptionPatch {
    /// An existing option of the group to keep (and update); without it a new option is created.
    pub id: Option<i64>,
    /// Reuse an existing product instead of creating one.
    pub product_id: Option<i64>,
    pub product: Option<ProductPatch>,
    pub price_cents: Option<i64>,
    #[serde(default, deserialize_with = "nullable")]
    pub original_price_cents: Option<Option<i64>>,
    pub status: Option<String>,
    #[serde(default, deserialize_with = "nullable")]
    pub external_code: Option<Option<String>>,
    pub max_quantity: Option<i64>,
    #[serde(default, deserialize_with = "nullable")]
    pub fractions: Option<Option<Vec<i64>>>,
    pub size_prices: Option<Vec<SizePrice>>,
    #[serde(default, deserialize_with = "nullable")]
    pub item_id: Option<Option<i64>>,
    pub position: Option<i64>,
}

impl OptionPatch {
    pub fn apply(&self, option: &mut MenuOption) {
        set(&self.price_cents, &mut option.price_cents);
        set(&self.original_price_cents, &mut option.original_price_cents);
        set(&self.status, &mut option.status);
        clean(&self.external_code, &mut option.external_code);
        set(&self.max_quantity, &mut option.max_quantity);
        set(&self.fractions, &mut option.fractions);
        set(&self.item_id, &mut option.item_id);
        set(&self.position, &mut option.position);
    }
}

pub fn new_option() -> MenuOption {
    MenuOption {
        status: "available".into(),
        max_quantity: 1,
        ..MenuOption::default()
    }
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct GroupPatch {
    pub name: Option<String>,
    #[serde(rename = "type")]
    pub kind: Option<String>,
    #[serde(default, deserialize_with = "nullable")]
    pub external_code: Option<Option<String>>,
    pub status: Option<String>,
    /// Replaces every option of the group when present.
    pub options: Option<Vec<OptionPatch>>,
}

impl GroupPatch {
    pub fn apply(&self, group: &mut Group) {
        if let Some(name) = &self.name {
            group.name = name.trim().into();
        }
        set(&self.kind, &mut group.kind);
        clean(&self.external_code, &mut group.external_code);
        set(&self.status, &mut group.status);
    }
}

pub fn new_group() -> Group {
    Group {
        kind: "ingredients".into(),
        status: "available".into(),
        ..Group::default()
    }
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct SettingsPatch {
    pub pizza_pricing: Option<String>,
    pub notes_max_length: Option<i64>,
    pub timezone: Option<String>,
}

impl SettingsPatch {
    pub fn apply(&self, settings: &mut MenuSettings) {
        set(&self.pizza_pricing, &mut settings.pizza_pricing);
        set(&self.notes_max_length, &mut settings.notes_max_length);
        set(&self.timezone, &mut settings.timezone);
    }
}
