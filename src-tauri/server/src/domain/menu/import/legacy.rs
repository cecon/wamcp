//! Consumer (legacy) format: `{ data: { menu: [ { code, name, itens: [ { id, code, description,
//! details, logoUrl, unitPrice, unitMinPrice, unitOriginalPrice, choices: [ { code, name, min, max,
//! garnishItens: [ { id, code, description, unitPrice, logoUrl } ] } ] } ] } ] } }`. Item and option
//! names come in `description`, item descriptions in `details`, the PDV code in `externalCode`
//! (`code` is usually just the iFood id) and paused items have `enabled: false` or an `availability`
//! other than `AVAILABLE`. The store page lists items without `choices`: the complements of an item
//! with `needChoices` come in its own detail response (`/items/{id}`, same shape), merged by id.
//!
//! Pizza heuristics (the consumer format has no template): a choice named like "tamanho" is the size,
//! "sabor" choices are flavours (merged into one topping group whose maximum is the sum of theirs),
//! "massa" the crust and "borda" the edge. A category is a pizza category when one of its items has
//! size and flavour choices, or when its name says "pizza" and an item has a size choice; then a
//! flavour-only item ("Calabresa" with sizes) gets a one-option topping group with its own name.
use super::json::{array, find as walk, int, number, price, text};
use super::{ImportCategory, ImportGroup, ImportItem, ImportOption};
use crate::domain::menu::images::image_source;
use crate::domain::menu::money::cents;
use crate::domain::menu::rules::fold;
use serde_json::Value;
use std::collections::HashMap;

/// The `menu` array of a consumer payload, wherever it sits (API response or `__NEXT_DATA__`).
pub fn find(payload: &Value) -> Option<&Vec<Value>> {
    walk(payload, 8, &|v| {
        let menu = v.get("menu")?.as_array()?;
        menu.iter()
            .any(|c| c.get("itens").is_some_and(Value::is_array))
            .then_some(menu)
    })
}

/// The store's menu among the captured ones (the first with most items), with the complements of
/// items whose `choices` only came in their own detail response.
pub fn merged(payloads: &[Value]) -> Option<Vec<Value>> {
    let menus: Vec<&Vec<Value>> = payloads.iter().filter_map(find).collect();
    let size = |menu: &&&Vec<Value>| menu.iter().map(|c| array(c, "itens").len()).sum::<usize>();
    let mut menu = (*menus.iter().rev().max_by_key(size)?).clone();
    let mut details: HashMap<String, &Value> = HashMap::new();
    for item in menus.iter().flat_map(|m| m.iter()).flat_map(|c| array(c, "itens")) {
        if let (Some(id), false) = (text(item, "id"), array(item, "choices").is_empty()) {
            details.entry(id).or_insert(&item["choices"]);
        }
    }
    for category in &mut menu {
        let Some(items) = category.get_mut("itens").and_then(Value::as_array_mut) else {
            continue;
        };
        for item in items {
            let missing = array(item, "choices").is_empty();
            let found = text(item, "id").and_then(|id| details.get(&id).copied());
            if let (true, Some(found), Some(fields)) = (missing, found, item.as_object_mut()) {
                fields.insert("choices".into(), found.clone());
            }
        }
    }
    Some(menu)
}

/// PDV code: `externalCode`, else a `code` that is not just the iFood id.
fn pdv_code(value: &Value) -> Option<String> {
    let id = text(value, "id");
    text(value, "externalCode").or_else(|| text(value, "code").filter(|c| Some(c) != id.as_ref()))
}

/// Paused on iFood: `enabled: false` or an `availability` other than `AVAILABLE`.
fn availability(value: &Value) -> String {
    let paused = value.get("enabled") == Some(&Value::Bool(false))
        || text(value, "availability").is_some_and(|a| !a.eq_ignore_ascii_case("AVAILABLE"));
    if paused { "unavailable" } else { "available" }.into()
}

fn has(choice: &Value, word: &str) -> bool {
    fold(&text(choice, "name").unwrap_or_default()).contains(word)
}

fn has_choice(item: &Value, word: &str) -> bool {
    array(item, "choices").iter().any(|c| has(c, word))
}

fn is_pizza_category(category: &Value) -> bool {
    let items = array(category, "itens");
    let named = fold(&text(category, "name").unwrap_or_default()).contains("pizza");
    items
        .iter()
        .any(|i| has_choice(i, "tamanho") && (has_choice(i, "sabor") || named))
}

fn option(garnish: &Value) -> ImportOption {
    let price_cents = price(garnish, "unitPrice").unwrap_or(0);
    ImportOption {
        name: text(garnish, "description").unwrap_or_default(),
        description: text(garnish, "details"),
        price_cents,
        original_price_cents: number(garnish, "unitOriginalPrice").map(cents),
        external_code: pdv_code(garnish),
        ifood_id: text(garnish, "id").or_else(|| text(garnish, "code")),
        status: availability(garnish),
        max_quantity: 1,
        image_url: text(garnish, "logoUrl").and_then(|l| image_source(&l)),
        ..ImportOption::default()
    }
}

fn group_kind(choice: &Value, options: &[ImportOption], max: i64) -> &'static str {
    let name = fold(&text(choice, "name").unwrap_or_default());
    if ["bebida", "refrigerante", "suco"].iter().any(|w| name.contains(w)) {
        "offer_unit"
    } else if name.contains("talher") {
        "cutlery"
    } else if max == 1 && options.iter().all(|o| o.price_cents == 0) {
        "specification"
    } else {
        "ingredients"
    }
}

fn group(choice: &Value, kind: &str) -> ImportGroup {
    let options: Vec<ImportOption> = array(choice, "garnishItens").iter().map(option).collect();
    let max = int(choice, "max").unwrap_or(1);
    ImportGroup {
        name: text(choice, "name").unwrap_or_default(),
        kind: if kind.is_empty() {
            group_kind(choice, &options, max).into()
        } else {
            kind.into()
        },
        min: int(choice, "min").unwrap_or(0),
        max,
        external_code: None,
        ifood_id: text(choice, "code"),
        status: "available".into(),
        options,
    }
}

fn base(item: &Value) -> ImportItem {
    let unit = price(item, "unitPrice").filter(|p| *p > 0);
    ImportItem {
        name: text(item, "description").unwrap_or_default(),
        description: text(item, "details"),
        price_cents: unit.or_else(|| price(item, "unitMinPrice")).unwrap_or(0),
        original_price_cents: number(item, "unitOriginalPrice").map(cents),
        external_code: pdv_code(item),
        ifood_id: text(item, "id"),
        status: availability(item),
        image_url: text(item, "logoUrl").and_then(|l| image_source(&l)),
        serving: "not_applicable".into(),
        ..ImportItem::default()
    }
}

/// Size, flavours, crust and edge groups of a pizza item (flavours merged into one group).
fn pizza(item: &Value) -> ImportItem {
    let mut converted = base(item);
    let choices = array(item, "choices");
    let flavours: Vec<&Value> = choices.iter().filter(|c| has(c, "sabor")).collect();
    let max_flavours = flavours.iter().map(|c| int(c, "max").unwrap_or(1)).sum::<i64>().max(1);
    let mut topping = ImportGroup {
        name: "Sabores".into(),
        kind: "topping".into(),
        min: 1,
        max: max_flavours,
        status: "available".into(),
        ..ImportGroup::default()
    };
    for choice in &flavours {
        for option in group(choice, "topping").options {
            if !topping.options.iter().any(|o| o.key() == option.key()) {
                topping.options.push(option);
            }
        }
    }
    if flavours.is_empty() {
        topping.name = "Sabor".into();
        topping.options.push(ImportOption {
            name: converted.name.clone(),
            ifood_id: converted.ifood_id.as_ref().map(|id| format!("{id}:sabor")),
            status: "available".into(),
            max_quantity: 1,
            ..ImportOption::default()
        });
    }
    let fractions: Vec<i64> = (1..=max_flavours.min(4)).collect();
    let mut groups = Vec::new();
    for choice in choices.iter().filter(|c| !has(c, "sabor")) {
        let kind = if has(choice, "tamanho") {
            "size"
        } else if has(choice, "massa") {
            "crust"
        } else if has(choice, "borda") {
            "edge"
        } else {
            ""
        };
        let mut converted_group = group(choice, kind);
        if kind == "size" {
            for size in &mut converted_group.options {
                if size.price_cents == 0 && flavours.is_empty() {
                    size.price_cents = converted.price_cents;
                }
                size.fractions = Some(fractions.clone());
            }
        }
        groups.push(converted_group);
    }
    let at = groups.iter().position(|g| g.kind == "size").map_or(0, |p| p + 1);
    groups.insert(at, topping);
    converted.price_cents = 0;
    converted.original_price_cents = None;
    converted.groups = groups;
    converted
}

pub fn convert(menu: &[Value]) -> Vec<ImportCategory> {
    menu.iter()
        .map(|category| {
            let is_pizza = is_pizza_category(category);
            let items = array(category, "itens")
                .iter()
                .map(|item| {
                    if is_pizza && has_choice(item, "tamanho") {
                        pizza(item)
                    } else {
                        let mut converted = base(item);
                        converted.groups = array(item, "choices").iter().map(|c| group(c, "")).collect();
                        converted
                    }
                })
                .collect();
            ImportCategory {
                name: text(category, "name").unwrap_or_default(),
                description: None,
                template: if is_pizza { "pizza" } else { "default" }.into(),
                external_code: None,
                ifood_id: text(category, "code"),
                status: "available".into(),
                items,
            }
        })
        .collect()
}
