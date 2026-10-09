//! Brings a converted tree within the catalog rules, so applying it never fails validation:
//! lengths are cut, prices and bounds fixed, category names made unique, a single pizza category
//! kept (extra ones become `default`) and pizza items given the size/flavour structure.
use super::{ImportCategory, ImportGroup, ImportItem, ImportOption, ImportTree};
use crate::domain::menu::model::{DIETARY, GROUP_TYPES, SERVINGS};
use crate::domain::menu::rules::{fold, MAX_PRICE_CENTS};

fn cut(text: &str, max: usize) -> String {
    let trimmed: String = text.trim().chars().take(max).collect();
    trimmed.trim_end().to_string()
}

fn cut_optional(text: &Option<String>, max: usize) -> Option<String> {
    text.as_deref().map(|t| cut(t, max)).filter(|t| !t.is_empty())
}

fn name(text: &str, max: usize) -> String {
    Some(cut(text, max))
        .filter(|n| !n.is_empty())
        .unwrap_or_else(|| "Sem nome".into())
}

fn price(value: i64) -> i64 {
    value.clamp(0, MAX_PRICE_CENTS)
}

fn original(price: i64, original: Option<i64>) -> Option<i64> {
    original.filter(|o| *o > price && *o <= MAX_PRICE_CENTS)
}

fn status(value: &str) -> String {
    if value == "unavailable" {
        "unavailable"
    } else {
        "available"
    }
    .into()
}

/// Identity of a group across items: its iFood id, else its name, type and option names.
pub fn group_key(group: &ImportGroup) -> String {
    group.ifood_id.clone().unwrap_or_else(|| {
        let options: Vec<String> = group.options.iter().map(|o| fold(&o.name)).collect();
        format!("{}|{}|{}", fold(&group.name), group.kind, options.join(","))
    })
}

fn option(o: &mut ImportOption, kind: &str) {
    o.name = name(&o.name, 120);
    o.description = cut_optional(&o.description, 1000);
    o.price_cents = price(o.price_cents);
    o.original_price_cents = original(o.price_cents, o.original_price_cents);
    o.external_code = cut_optional(&o.external_code, 60);
    o.status = status(&o.status);
    o.max_quantity = o.max_quantity.clamp(1, 99);
    o.fractions = match kind {
        "size" => {
            let mut fractions: Vec<i64> = o.fractions.clone().unwrap_or_default();
            fractions.retain(|f| (1..=4).contains(f));
            fractions.sort_unstable();
            fractions.dedup();
            Some(if fractions.is_empty() { vec![1] } else { fractions })
        }
        _ => None,
    };
    if kind != "topping" {
        o.size_prices.clear();
    }
    for size in &mut o.size_prices {
        size.price_cents = price(size.price_cents);
    }
}

fn group(g: &mut ImportGroup) {
    g.name = name(&g.name, 80);
    if !GROUP_TYPES.contains(&g.kind.as_str()) {
        g.kind = "ingredients".into();
    }
    g.external_code = cut_optional(&g.external_code, 60);
    g.status = status(&g.status);
    g.options.truncate(crate::domain::menu::rules::MAX_OPTIONS);
    let kind = g.kind.clone();
    g.options.iter_mut().for_each(|o| option(o, &kind));
    g.min = g.min.clamp(0, 99);
    g.max = g.max.clamp(g.min.max(1), 99);
}

/// Pizza items: price from the size; size 1..1, crust 1..1, edge 0..1, flavours up to the sizes' fractions.
fn pizza(item: &mut ImportItem) {
    item.price_cents = 0;
    item.original_price_cents = None;
    let flavours = item
        .groups
        .iter()
        .filter(|g| g.kind == "size")
        .flat_map(|g| g.options.iter().filter_map(|o| o.fractions.clone()).flatten())
        .max()
        .unwrap_or(1);
    for g in &mut item.groups {
        (g.min, g.max) = match g.kind.as_str() {
            "size" | "crust" => (1, 1),
            "edge" => (0, 1),
            "topping" => (1, flavours),
            _ => (g.min, g.max),
        };
    }
}

fn item(i: &mut ImportItem, template: &str) {
    i.name = name(&i.name, 120);
    i.description = cut_optional(&i.description, 1000);
    i.price_cents = price(i.price_cents);
    i.original_price_cents = original(i.price_cents, i.original_price_cents);
    i.external_code = cut_optional(&i.external_code, 60);
    i.product_code = cut_optional(&i.product_code, 60);
    i.status = status(&i.status);
    i.ean = i
        .ean
        .clone()
        .filter(|e| e.len() <= 14 && e.chars().all(|c| c.is_ascii_digit()));
    if !SERVINGS.contains(&i.serving.as_str()) {
        i.serving = "not_applicable".into();
    }
    i.dietary.retain(|d| DIETARY.contains(&d.as_str()));
    i.dietary.dedup();
    i.shifts.truncate(crate::domain::menu::rules::MAX_SHIFTS);
    i.groups.truncate(crate::domain::menu::rules::MAX_LINKS);
    i.groups.iter_mut().for_each(group);
    let mut seen = Vec::new();
    i.groups.retain(|g| {
        let key = group_key(g);
        let fresh = !seen.contains(&key);
        seen.push(key);
        fresh
    });
    if template == "pizza" {
        pizza(i);
    }
}

fn category(c: &mut ImportCategory, taken: &mut Vec<String>, pizza_taken: &mut bool) {
    c.name = name(&c.name, 76);
    let base = c.name.clone();
    let mut counter = 1;
    while taken.contains(&fold(&c.name)) {
        counter += 1;
        c.name = format!("{base} ({counter})");
    }
    taken.push(fold(&c.name));
    c.description = cut_optional(&c.description, 500);
    c.external_code = cut_optional(&c.external_code, 60);
    c.status = status(&c.status);
    if c.template == "pizza" {
        if *pizza_taken {
            c.template = "default".into();
        }
        *pizza_taken = true;
    } else if c.template != "combo" {
        c.template = "default".into();
    }
    let template = c.template.clone();
    c.items.iter_mut().for_each(|i| item(i, &template));
}

pub fn normalize(mut tree: ImportTree) -> ImportTree {
    let (mut taken, mut pizza_taken) = (Vec::new(), false);
    tree.categories.retain(|c| !c.items.is_empty());
    for c in &mut tree.categories {
        category(c, &mut taken, &mut pizza_taken);
    }
    if tree.pizza_pricing != "average" {
        tree.pizza_pricing = "greater".into();
    }
    tree
}
