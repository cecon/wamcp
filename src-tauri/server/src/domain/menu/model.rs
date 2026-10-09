//! Catalog entities. Rows mirror the SQLite columns; the `*View` types are the API shapes (an item
//! with its product, linked groups and options expanded, as `GET /catalog/items/{id}` returns it).
use serde::{Deserialize, Serialize, Serializer};

pub const STATUSES: [&str; 2] = ["available", "unavailable"];
pub const TEMPLATES: [&str; 3] = ["default", "pizza", "combo"];
pub const GROUP_TYPES: [&str; 9] = [
    "ingredients",
    "specification",
    "offer_unit",
    "cutlery",
    "size",
    "crust",
    "edge",
    "topping",
    "combo_main",
];
pub const SERVINGS: [&str; 5] = ["not_applicable", "serves_1", "serves_2", "serves_3", "serves_4"];
pub const DIETARY: [&str; 10] = [
    "vegetarian",
    "vegan",
    "organic",
    "gluten_free",
    "sugar_free",
    "lactose_free",
    "alcoholic",
    "natural",
    "zero",
    "diet",
];
pub const PIZZA_PRICING: [&str; 2] = ["greater", "average"];
/// Where product photos are served (`image` holds the file name under `catalog/` in the data dir).
pub const IMAGE_ROUTE: &str = "/api/v1/catalog/images/";

fn image_url<S: Serializer>(image: &Option<String>, serializer: S) -> Result<S::Ok, S::Error> {
    image
        .as_ref()
        .map(|file| format!("{IMAGE_ROUTE}{file}"))
        .serialize(serializer)
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Category {
    pub id: i64,
    pub name: String,
    pub description: Option<String>,
    pub template: String,
    pub external_code: Option<String>,
    pub status: String,
    pub position: i64,
    pub ifood_id: Option<String>,
    #[serde(default)]
    pub items_count: i64,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Product {
    pub id: i64,
    pub name: String,
    pub description: Option<String>,
    pub external_code: Option<String>,
    pub ean: Option<String>,
    pub serving: String,
    #[serde(default)]
    pub dietary: Vec<String>,
    /// Stored file name; exposed as `image_url`.
    #[serde(rename(serialize = "image_url"), serialize_with = "image_url")]
    pub image: Option<String>,
    pub slices: Option<i64>,
    pub ifood_id: Option<String>,
}

/// Availability window: `days` 0 (Sunday)..6, `start`/`end` "HH:MM"; `end` < `start` crosses midnight.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Shift {
    pub days: Vec<i64>,
    pub start: String,
    pub end: String,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Item {
    pub id: i64,
    pub category_id: i64,
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(skip_serializing)]
    pub product_id: i64,
    pub price_cents: i64,
    pub original_price_cents: Option<i64>,
    pub status: String,
    pub external_code: Option<String>,
    #[serde(default)]
    pub shifts: Vec<Shift>,
    pub position: i64,
    pub ifood_id: Option<String>,
}

/// An item's use of a group, with the item-specific minimum and maximum.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Link {
    #[serde(skip_serializing, default)]
    pub item_id: i64,
    pub group_id: i64,
    pub min: i64,
    pub max: i64,
    #[serde(default)]
    pub position: i64,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Group {
    pub id: i64,
    pub name: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub external_code: Option<String>,
    pub status: String,
    pub ifood_id: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct MenuOption {
    pub id: i64,
    #[serde(skip_serializing)]
    pub group_id: i64,
    #[serde(skip_serializing)]
    pub product_id: i64,
    pub price_cents: i64,
    pub original_price_cents: Option<i64>,
    pub status: String,
    pub external_code: Option<String>,
    pub max_quantity: i64,
    pub fractions: Option<Vec<i64>>,
    pub item_id: Option<i64>,
    pub position: i64,
    pub ifood_id: Option<String>,
}

/// A topping's price when the pizza has the size option `size_option_id`.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct SizePrice {
    #[serde(skip_serializing, default)]
    pub option_id: i64,
    pub size_option_id: i64,
    pub price_cents: i64,
}

/// Store-wide catalog settings. `timezone` evaluates shifts (the account has no timezone of its own).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MenuSettings {
    pub pizza_pricing: String,
    pub notes_max_length: i64,
    pub timezone: String,
}

impl Default for MenuSettings {
    fn default() -> Self {
        Self {
            pizza_pricing: "greater".into(),
            notes_max_length: 140,
            timezone: "America/Sao_Paulo".into(),
        }
    }
}

/// Every catalog row, as loaded from the store.
#[derive(Debug, Clone, Default)]
pub struct MenuRows {
    pub categories: Vec<Category>,
    pub products: Vec<Product>,
    pub items: Vec<Item>,
    pub links: Vec<Link>,
    pub groups: Vec<Group>,
    pub options: Vec<MenuOption>,
    pub size_prices: Vec<SizePrice>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct OptionView {
    #[serde(flatten)]
    pub option: MenuOption,
    pub product: Product,
    pub size_prices: Vec<SizePrice>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct GroupView {
    #[serde(flatten)]
    pub group: Group,
    pub options: Vec<OptionView>,
    pub used_by: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct LinkView {
    #[serde(flatten)]
    pub link: Link,
    pub group: GroupView,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ItemView {
    #[serde(flatten)]
    pub item: Item,
    pub product: Product,
    pub groups: Vec<LinkView>,
    pub available_now: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct CategoryView {
    #[serde(flatten)]
    pub category: Category,
    pub items: Vec<ItemView>,
}

/// The whole menu (`GET /catalog`).
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Menu {
    pub settings: MenuSettings,
    pub categories: Vec<CategoryView>,
}

impl Menu {
    pub fn items(&self) -> impl Iterator<Item = &ItemView> {
        self.categories.iter().flat_map(|c| c.items.iter())
    }

    pub fn item(&self, id: i64) -> Option<&ItemView> {
        self.items().find(|i| i.item.id == id)
    }

    pub fn category(&self, id: i64) -> Option<&CategoryView> {
        self.categories.iter().find(|c| c.category.id == id)
    }
}

/// An item request in an order: `choices` are chosen options (nested ones complement a combo's item).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Choice {
    pub option_id: i64,
    #[serde(default = "one")]
    pub quantity: i64,
    #[serde(default)]
    pub choices: Vec<Choice>,
}

fn one() -> i64 {
    1
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct QuoteRequest {
    pub item_id: i64,
    #[serde(default = "one")]
    pub quantity: i64,
    #[serde(default)]
    pub notes: Option<String>,
    #[serde(default)]
    pub choices: Vec<Choice>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct QuoteLine {
    pub name: String,
    pub external_code: Option<String>,
    pub quantity: i64,
    pub unit_price_cents: i64,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Quote {
    pub unit_price_cents: i64,
    pub total_price_cents: i64,
    pub lines: Vec<QuoteLine>,
    pub errors: Vec<String>,
}
