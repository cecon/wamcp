//! Pizza and combo structure rules and the pizza flavour pricing (`greater` or `average`).
use super::model::{GroupView, Link, OptionView};
use super::money::ceil_div;
use super::rules::link_bounds;
use crate::domain::error::{fail, fail_with, Result};

fn of_kind<'a>(links: &'a [(Link, GroupView)], kind: &str) -> Vec<&'a (Link, GroupView)> {
    links.iter().filter(|(_, g)| g.group.kind == kind).collect()
}

/// Largest number of flavours any size accepts.
pub fn max_fractions(size: &GroupView) -> i64 {
    size.options
        .iter()
        .filter_map(|o| o.option.fractions.as_ref())
        .flat_map(|f| f.iter().copied())
        .max()
        .unwrap_or(1)
}

/// The groups linked to an item of type `kind`: bounds, no repeats, and the pizza/combo structure.
pub fn validate_links(kind: &str, links: &[(Link, GroupView)]) -> Result<()> {
    let mut seen = Vec::new();
    for (link, group) in links {
        if seen.contains(&link.group_id) {
            return fail(format!("O grupo ‘{}’ foi vinculado duas vezes", group.group.name));
        }
        seen.push(link.group_id);
        link_bounds(&group.group.name, link.min, link.max)?;
    }
    match kind {
        "pizza" => validate_pizza(links),
        "combo" if of_kind(links, "combo_main").len() != 1 => {
            fail_with("O combo precisa de exatamente um grupo principal (combo_main)", 422)
        }
        _ => Ok(()),
    }
}

fn validate_pizza(links: &[(Link, GroupView)]) -> Result<()> {
    let sizes = of_kind(links, "size");
    let [(size_link, size)] = sizes.as_slice() else {
        return fail_with("A pizza precisa de um grupo de tamanho", 422);
    };
    if (size_link.min, size_link.max) != (1, 1) {
        return fail_with("O tamanho da pizza deve ter mínimo 1 e máximo 1", 422);
    }
    let toppings = of_kind(links, "topping");
    let [(topping_link, _)] = toppings.as_slice() else {
        return fail_with("A pizza precisa de um grupo de sabores", 422);
    };
    let flavours = max_fractions(size);
    if topping_link.min < 1 || topping_link.max != flavours {
        return fail_with(
            format!("Os sabores devem ter mínimo 1 e máximo {flavours} (maior fração dos tamanhos)"),
            422,
        );
    }
    let crusts = of_kind(links, "crust");
    if crusts.len() > 1 || crusts.iter().any(|(l, _)| (l.min, l.max) != (1, 1)) {
        return fail_with("A massa da pizza deve ter mínimo 1 e máximo 1", 422);
    }
    let edges = of_kind(links, "edge");
    if edges.len() > 1 || edges.iter().any(|(l, _)| (l.min, l.max) != (0, 1)) {
        return fail_with("A borda da pizza deve ter mínimo 0 e máximo 1", 422);
    }
    Ok(())
}

/// A flavour's price in the chosen size (its own price when no per-size price is set).
pub fn topping_price(topping: &OptionView, size_option_id: Option<i64>) -> i64 {
    size_option_id
        .and_then(|size| topping.size_prices.iter().find(|p| p.size_option_id == size))
        .map_or(topping.option.price_cents, |p| p.price_cents)
}

/// What the flavours cost: `greater` charges the most expensive, `average` the mean rounded up.
/// Each entry is (price, fractions of the pizza taken by that flavour).
pub fn topping_charge(rule: &str, flavours: &[(i64, i64)]) -> i64 {
    let parts: i64 = flavours.iter().map(|(_, q)| q).sum();
    if parts == 0 {
        return 0;
    }
    if rule == "average" {
        ceil_div(flavours.iter().map(|(p, q)| p * q).sum(), parts)
    } else {
        flavours.iter().map(|(p, _)| *p).max().unwrap_or(0)
    }
}

/// Splits `charge` over `parts` fractions (the remainder goes to the first) so lines add up.
pub fn shares(charge: i64, parts: i64) -> Vec<i64> {
    if parts <= 0 {
        return Vec::new();
    }
    let base = charge.div_euclid(parts);
    let mut out = vec![base; parts as usize];
    out[0] += charge - base * parts;
    out
}
