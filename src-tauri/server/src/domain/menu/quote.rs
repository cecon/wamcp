//! The order calculator behind `POST /catalog/quote` and the `catalog_quote` tool: validates the
//! choices against each linked group (min/max, membership, availability, `max_quantity`), applies the
//! pizza flavour rule and nested combo choices, and prices the item. Problems are collected as
//! Portuguese messages in `errors`; prices are still computed on a best-effort basis.
use super::model::{Choice, ItemView, LinkView, Menu, OptionView, Quote, QuoteLine, QuoteRequest};
use super::pizza::{shares, topping_charge, topping_price};
use crate::domain::error::{HelpdeskError, Result};

/// Combos nest at most three levels, like iFood (combo → item → complements).
const MAX_DEPTH: usize = 2;
pub const MAX_QUANTITY: i64 = 99;

struct Pick<'a> {
    link: &'a LinkView,
    option: &'a OptionView,
    choice: &'a Choice,
}

struct Builder<'a> {
    menu: &'a Menu,
    lines: Vec<QuoteLine>,
    errors: Vec<String>,
}

fn plural(count: i64, one: &str, many: &str) -> String {
    format!("{count} {}", if count == 1 { one } else { many })
}

fn line(option: &OptionView, name: String, quantity: i64, unit: i64) -> QuoteLine {
    QuoteLine {
        name,
        external_code: option
            .option
            .external_code
            .clone()
            .or_else(|| option.product.external_code.clone()),
        quantity,
        unit_price_cents: unit,
    }
}

pub fn quote(menu: &Menu, request: &QuoteRequest) -> Result<Quote> {
    let item = menu
        .item(request.item_id)
        .ok_or_else(|| HelpdeskError::not_found("Item não encontrado"))?;
    let mut builder = Builder {
        menu,
        lines: Vec::new(),
        errors: Vec::new(),
    };
    if !(1..=MAX_QUANTITY).contains(&request.quantity) {
        builder
            .errors
            .push(format!("A quantidade deve ser de 1 a {MAX_QUANTITY}"));
    }
    let limit = menu.settings.notes_max_length;
    if let Some(notes) = &request.notes {
        if notes.chars().count() as i64 > limit {
            builder
                .errors
                .push(format!("A observação deve ter até {limit} caracteres"));
        }
    }
    builder.lines.push(QuoteLine {
        name: item.product.name.clone(),
        external_code: item
            .item
            .external_code
            .clone()
            .or_else(|| item.product.external_code.clone()),
        quantity: 1,
        unit_price_cents: item.item.price_cents,
    });
    let unit = item.item.price_cents + builder.choices(item, &request.choices, 0);
    Ok(Quote {
        unit_price_cents: unit,
        total_price_cents: unit * request.quantity.clamp(0, MAX_QUANTITY),
        lines: builder.lines,
        errors: builder.errors,
    })
}

impl<'a> Builder<'a> {
    fn unavailable(&mut self, name: &str) {
        self.errors.push(format!("‘{name}’ não está disponível agora"));
    }

    /// Resolves each choice to an option of one of the item's groups.
    fn picks(&mut self, item: &'a ItemView, choices: &'a [Choice]) -> Vec<Pick<'a>> {
        let mut picks = Vec::new();
        for choice in choices {
            let found = item.groups.iter().find_map(|link| {
                link.group
                    .options
                    .iter()
                    .find(|o| o.option.id == choice.option_id)
                    .map(|option| Pick { link, option, choice })
            });
            let Some(pick) = found else {
                self.errors.push(format!(
                    "A opção {} não pertence a ‘{}’",
                    choice.option_id, item.product.name
                ));
                continue;
            };
            let name = &pick.option.product.name;
            if choice.quantity < 1 {
                self.errors.push(format!("Quantidade inválida em ‘{name}’"));
            } else if choice.quantity > pick.option.option.max_quantity {
                self.errors
                    .push(format!("Máximo de {} de ‘{name}’", pick.option.option.max_quantity));
            }
            if pick.option.option.status != "available" || pick.link.group.group.status != "available" {
                self.unavailable(name);
            }
            picks.push(pick);
        }
        picks
    }

    fn check_groups(&mut self, item: &ItemView, picks: &[Pick]) {
        for link in &item.groups {
            let chosen: i64 = picks
                .iter()
                .filter(|p| p.link.link.group_id == link.link.group_id)
                .map(|p| p.choice.quantity.max(0))
                .sum();
            let (min, max, name) = (link.link.min, link.link.max, &link.group.group.name);
            if chosen < min {
                self.errors.push(if min == max {
                    format!("Escolha {} em ‘{name}’", plural(min, "opção", "opções"))
                } else {
                    format!("Escolha pelo menos {min} em ‘{name}’")
                });
            } else if chosen > max {
                self.errors.push(format!("Máximo de {max} em ‘{name}’"));
            }
        }
    }

    /// The price the choices add to `item` (the item's own price excluded).
    fn choices(&mut self, item: &'a ItemView, choices: &'a [Choice], depth: usize) -> i64 {
        if !item.available_now {
            self.unavailable(&item.product.name);
        }
        let picks = self.picks(item, choices);
        self.check_groups(item, &picks);
        if item.item.kind == "pizza" {
            return self.pizza(&picks);
        }
        let mut total = 0;
        for pick in &picks {
            let quantity = pick.choice.quantity.max(0);
            let price = pick.option.option.price_cents;
            let name = pick.option.product.name.clone();
            self.lines.push(line(pick.option, name, quantity, price));
            total += price * quantity + self.nested(pick, depth) * quantity;
        }
        total
    }

    /// A combo option pointing at a menu item brings that item's own complements.
    fn nested(&mut self, pick: &Pick<'a>, depth: usize) -> i64 {
        let Some(item_id) = pick.option.option.item_id else {
            if !pick.choice.choices.is_empty() {
                let name = &pick.option.product.name;
                self.errors.push(format!("‘{name}’ não aceita complementos"));
            }
            return 0;
        };
        if depth >= MAX_DEPTH {
            self.errors.push("Complementos aninhados demais".into());
            return 0;
        }
        let Some(item) = self.menu.item(item_id) else {
            self.unavailable(&pick.option.product.name);
            return 0;
        };
        self.choices(item, &pick.choice.choices, depth + 1)
    }

    /// Size price + crust/edge/other extras + the flavours charged by the store rule.
    fn pizza(&mut self, picks: &[Pick<'a>]) -> i64 {
        let kind = |p: &Pick| p.link.group.group.kind.clone();
        let size = picks.iter().find(|p| kind(p) == "size").map(|p| p.option);
        let toppings: Vec<&Pick> = picks.iter().filter(|p| kind(p) == "topping").collect();
        let parts: i64 = toppings.iter().map(|p| p.choice.quantity.max(0)).sum();
        if let Some(size) = size {
            let accepted = size.option.fractions.clone().unwrap_or_else(|| vec![1]);
            if parts > 0 && !accepted.contains(&parts) {
                self.errors.push(format!(
                    "O tamanho ‘{}’ não aceita {}",
                    size.product.name,
                    plural(parts, "sabor", "sabores")
                ));
            }
        }
        let mut total = 0;
        for pick in picks.iter().filter(|p| kind(p) != "topping") {
            let quantity = pick.choice.quantity.max(0);
            let price = pick.option.option.price_cents;
            self.lines
                .push(line(pick.option, pick.option.product.name.clone(), quantity, price));
            total += price * quantity;
        }
        let size_id = size.map(|s| s.option.id);
        let flavours: Vec<(i64, i64)> = toppings
            .iter()
            .map(|p| (topping_price(p.option, size_id), p.choice.quantity.max(0)))
            .collect();
        let charge = topping_charge(&self.menu.settings.pizza_pricing, &flavours);
        let mut split = shares(charge, parts).into_iter();
        for pick in toppings {
            let quantity = pick.choice.quantity.max(0);
            let share: i64 = split.by_ref().take(quantity as usize).sum();
            let name = if parts > 1 {
                format!("{quantity}/{parts} {}", pick.option.product.name)
            } else {
                pick.option.product.name.clone()
            };
            self.lines.push(line(pick.option, name, 1, share));
        }
        total + charge
    }
}
