//! Catalog v2 format (partner API, `GET …/categories?includeItems=true`): `[ { id, name,
//! externalCode, status, template, items: [ { id, productId, status, price: { value, originalValue },
//! externalCode, shifts, contextModifiers } ], products, optionGroups, options } ]`. Products, option
//! groups and options are cross-referenced by id and may sit in any category or in a wrapper object
//! (`{ categories, products, optionGroups, options }`). Group links (`{ id, min, max }`) come from the
//! item or its product. Pizza groups use `optionGroupType` SIZE/CRUST/EDGE/TOPPING, sizes carry
//! `fractions` and toppings price per size in `contextModifiers[].parentOptionId`.
use super::json::{array, find as walk, int, original_price, price, status, text};
use super::{ImportCategory, ImportGroup, ImportItem, ImportOption, ImportSizePrice};
use crate::domain::menu::images::image_source;
use crate::domain::menu::model::Shift;
use serde_json::Value;
use std::collections::HashMap;

/// Products, option groups and options by id.
#[derive(Default)]
pub struct Pool<'a> {
    products: HashMap<String, &'a Value>,
    groups: HashMap<String, &'a Value>,
    options: HashMap<String, &'a Value>,
}

impl<'a> Pool<'a> {
    fn add(&mut self, holder: &'a Value) {
        for (key, map) in [
            ("products", &mut self.products),
            ("optionGroups", &mut self.groups),
            ("options", &mut self.options),
        ] {
            for entry in array(holder, key).iter().filter(|e| e.is_object()) {
                if let Some(id) = text(entry, "id") {
                    map.insert(id, entry);
                }
            }
        }
    }
}

fn is_category(value: &Value) -> bool {
    value.get("name").is_some()
        && value.get("items").is_some_and(Value::is_array)
        && (value.get("template").is_some() || array(value, "items").iter().any(|i| i.get("productId").is_some()))
}

/// The categories array (and the cross-reference pool) of a v2 payload.
pub fn find(payload: &Value) -> Option<(&Vec<Value>, Pool<'_>)> {
    walk(payload, 6, &|v| {
        let (categories, wrapper) = match v {
            Value::Array(list) => (list, None),
            Value::Object(_) => (v.get("categories")?.as_array()?, Some(v)),
            _ => return None,
        };
        if categories.is_empty() || !categories.iter().all(is_category) {
            return None;
        }
        let mut pool = Pool::default();
        wrapper.into_iter().for_each(|w| pool.add(w));
        categories.iter().for_each(|c| pool.add(c));
        Some((categories, pool))
    })
}

/// The `DEFAULT` context modifier (price/code of the plain delivery context).
fn default_context(value: &Value) -> Option<&Value> {
    array(value, "contextModifiers").iter().find(|m| {
        m.get("parentOptionId").is_none() && text(m, "catalogContext").is_none_or(|c| c.eq_ignore_ascii_case("DEFAULT"))
    })
}

fn code(value: &Value) -> Option<String> {
    text(value, "externalCode").or_else(|| default_context(value).and_then(|c| text(c, "externalCode")))
}

fn amount(value: &Value) -> (i64, Option<i64>) {
    let context = default_context(value);
    let price_cents = price(value, "price")
        .or_else(|| context.and_then(|c| price(c, "price")))
        .unwrap_or(0);
    let original = original_price(value, "price").or_else(|| context.and_then(|c| original_price(c, "price")));
    (price_cents, original)
}

fn image(product: &Value) -> Option<String> {
    ["image", "imagePath", "logoUrl"]
        .iter()
        .find_map(|k| text(product, k))
        .and_then(|i| image_source(&i))
}

fn lower(value: Option<String>) -> Option<String> {
    value.map(|v| v.to_ascii_lowercase())
}

fn shifts(item: &Value) -> Vec<Shift> {
    const DAYS: [&str; 7] = [
        "sunday",
        "monday",
        "tuesday",
        "wednesday",
        "thursday",
        "friday",
        "saturday",
    ];
    array(item, "shifts")
        .iter()
        .filter_map(|s| {
            let days: Vec<i64> = (0..7).filter(|d| s[DAYS[*d as usize]] == true).collect();
            let clip = |t: String| t.chars().take(5).collect::<String>();
            Some(Shift {
                days,
                start: clip(text(s, "startTime")?),
                end: clip(text(s, "endTime")?),
            })
        })
        .filter(|s| !s.days.is_empty())
        .collect()
}

impl Pool<'_> {
    fn product(&self, value: &Value) -> Value {
        text(value, "productId")
            .and_then(|id| self.products.get(&id))
            .map_or(Value::Null, |p| (*p).clone())
    }

    fn option(&self, value: &Value) -> ImportOption {
        let product = self.product(value);
        let (price_cents, original_price_cents) = amount(value);
        let size_prices = array(value, "contextModifiers")
            .iter()
            .filter_map(|m| {
                Some(ImportSizePrice {
                    size: text(m, "parentOptionId")?,
                    price_cents: price(m, "price")?,
                })
            })
            .collect();
        let fractions: Vec<i64> = array(value, "fractions").iter().filter_map(Value::as_i64).collect();
        ImportOption {
            name: text(&product, "name")
                .or_else(|| text(value, "name"))
                .unwrap_or_default(),
            description: text(&product, "description"),
            price_cents,
            original_price_cents,
            external_code: code(value).or_else(|| text(&product, "externalCode")),
            ifood_id: text(value, "id"),
            status: status(value),
            max_quantity: int(value, "maxQuantity").unwrap_or(1),
            fractions: (!fractions.is_empty()).then_some(fractions),
            size_prices,
            image_url: image(&product),
        }
    }

    fn group(&self, link: &Value) -> Option<ImportGroup> {
        let id = text(link, "id").or_else(|| text(link, "optionGroupId"))?;
        let group = *self.groups.get(&id)?;
        let kind = match text(group, "optionGroupType")
            .unwrap_or_default()
            .to_ascii_uppercase()
            .as_str()
        {
            "SIZE" => "size",
            "CRUST" => "crust",
            "EDGE" => "edge",
            "TOPPING" => "topping",
            "SPECIFICATION" => "specification",
            "CUTLERY" => "cutlery",
            "OFFER_UNIT" => "offer_unit",
            _ => "ingredients",
        };
        let mut ids: Vec<String> = array(group, "optionIds")
            .iter()
            .filter_map(|v| text(&json_id(v), "id"))
            .collect();
        let mut options: Vec<ImportOption> = Vec::new();
        for entry in array(group, "options") {
            match entry {
                Value::Object(_) if entry.get("productId").is_some() => options.push(self.option(entry)),
                other => ids.extend(text(&json_id(other), "id")),
            }
        }
        options.extend(ids.iter().filter_map(|id| self.options.get(id)).map(|o| self.option(o)));
        Some(ImportGroup {
            name: text(group, "name").unwrap_or_default(),
            kind: kind.into(),
            min: int(link, "min").unwrap_or(0),
            max: int(link, "max").unwrap_or(1),
            external_code: text(group, "externalCode"),
            ifood_id: Some(id),
            status: status(group),
            options,
        })
    }

    fn item(&self, value: &Value, template: &str) -> ImportItem {
        let product = self.product(value);
        let (price_cents, original_price_cents) = amount(value);
        let links = if array(value, "optionGroups").is_empty() {
            array(&product, "optionGroups")
        } else {
            array(value, "optionGroups")
        };
        let mut groups: Vec<ImportGroup> = links.iter().filter_map(|l| self.group(l)).collect();
        if template == "combo" && !groups.iter().any(|g| g.kind == "combo_main") {
            if let Some(first) = groups.first_mut() {
                first.kind = "combo_main".into();
            }
        }
        ImportItem {
            name: text(&product, "name")
                .or_else(|| text(value, "name"))
                .unwrap_or_default(),
            description: text(&product, "description"),
            price_cents,
            original_price_cents,
            external_code: code(value).or_else(|| text(&product, "externalCode")),
            product_code: text(&product, "externalCode"),
            ifood_id: text(value, "id"),
            status: status(value),
            image_url: image(&product),
            ean: text(&product, "ean"),
            serving: lower(text(&product, "serving")).unwrap_or_else(|| "not_applicable".into()),
            dietary: array(&product, "dietaryRestrictions")
                .iter()
                .filter_map(|d| d.as_str().map(str::to_ascii_lowercase))
                .collect(),
            shifts: shifts(value),
            groups,
        }
    }
}

/// Wraps a bare id (`"abc"` or `12`) so `text(…, "id")` reads it like an object's id.
fn json_id(value: &Value) -> Value {
    match value {
        Value::Object(_) => value.clone(),
        other => serde_json::json!({ "id": other }),
    }
}

pub fn convert(categories: &[Value], pool: &Pool) -> Vec<ImportCategory> {
    categories
        .iter()
        .map(|category| {
            let template = lower(text(category, "template"))
                .filter(|t| ["pizza", "combo"].contains(&t.as_str()))
                .unwrap_or_else(|| "default".into());
            let mut items: Vec<&Value> = array(category, "items").iter().collect();
            items.sort_by_key(|i| int(i, "index").unwrap_or(0));
            ImportCategory {
                name: text(category, "name").unwrap_or_default(),
                description: text(category, "description"),
                external_code: text(category, "externalCode"),
                ifood_id: text(category, "id"),
                status: status(category),
                items: items.into_iter().map(|i| pool.item(i, &template)).collect(),
                template,
            }
        })
        .collect()
}
