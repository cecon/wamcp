//! Validation of catalog entries: malformed values are 400, business rules 422 (as in the contract).
use super::availability::minutes;
use super::model::{
    Category, Group, Item, MenuOption, MenuSettings, Product, DIETARY, GROUP_TYPES, PIZZA_PRICING, SERVINGS, STATUSES,
    TEMPLATES,
};
use crate::domain::error::{fail, fail_with, Result};
use crate::domain::schedule::validate_timezone;

pub const MAX_PRICE_CENTS: i64 = 100_000_000;
pub const MAX_SHIFTS: usize = 20;
pub const MAX_OPTIONS: usize = 200;
pub const MAX_LINKS: usize = 30;

fn length(value: &str, min: usize, max: usize, message: &str) -> Result<()> {
    let count = value.chars().count();
    if (min..=max).contains(&count) {
        Ok(())
    } else {
        fail(message)
    }
}

fn optional(value: &Option<String>, max: usize, message: &str) -> Result<()> {
    value.as_deref().map_or(Ok(()), |v| length(v, 0, max, message))
}

fn member(value: &str, allowed: &[&str], message: &str) -> Result<()> {
    if allowed.contains(&value) {
        Ok(())
    } else {
        fail(message)
    }
}

fn code(value: &Option<String>) -> Result<()> {
    optional(value, 60, "O código PDV deve ter até 60 caracteres")
}

fn status(value: &str) -> Result<()> {
    member(value, &STATUSES, "Situação inválida (use available ou unavailable)")
}

/// `price ≥ 0`; a "de" price must be above the "por" price.
pub fn prices(price: i64, original: Option<i64>) -> Result<()> {
    if !(0..=MAX_PRICE_CENTS).contains(&price) {
        return fail("Preço inválido");
    }
    match original {
        Some(o) if o > MAX_PRICE_CENTS => fail("Preço original inválido"),
        Some(o) if o <= price => fail_with("O preço original deve ser maior que o preço", 422),
        _ => Ok(()),
    }
}

pub fn category(c: &Category) -> Result<()> {
    length(&c.name, 1, 80, "O nome da categoria deve ter de 1 a 80 caracteres")?;
    optional(&c.description, 500, "A descrição deve ter até 500 caracteres")?;
    member(&c.template, &TEMPLATES, "Modelo de categoria inválido")?;
    code(&c.external_code)?;
    status(&c.status)
}

pub fn product(p: &Product) -> Result<()> {
    length(&p.name, 1, 120, "O nome do produto deve ter de 1 a 120 caracteres")?;
    optional(&p.description, 1000, "A descrição deve ter até 1000 caracteres")?;
    code(&p.external_code)?;
    if let Some(ean) = &p.ean {
        if ean.len() > 14 || !ean.chars().all(|c| c.is_ascii_digit()) {
            return fail("O EAN deve ter até 14 dígitos");
        }
    }
    member(&p.serving, &SERVINGS, "Porção inválida")?;
    if p.dietary.iter().any(|d| !DIETARY.contains(&d.as_str())) {
        return fail("Restrição alimentar inválida");
    }
    match p.slices {
        Some(s) if !(1..=32).contains(&s) => fail("Número de fatias inválido"),
        _ => Ok(()),
    }
}

pub fn item(i: &Item) -> Result<()> {
    prices(i.price_cents, i.original_price_cents)?;
    status(&i.status)?;
    code(&i.external_code)?;
    if i.shifts.len() > MAX_SHIFTS {
        return fail("Horários demais");
    }
    for shift in &i.shifts {
        let days_ok = !shift.days.is_empty() && shift.days.iter().all(|d| (0..7).contains(d));
        if !days_ok || minutes(&shift.start).is_none() || minutes(&shift.end).is_none() {
            return fail("Horário inválido: use dias de 0 a 6 e horas HH:MM");
        }
    }
    if i.kind == "pizza" && i.price_cents != 0 {
        return fail_with("Em pizza o preço vem do tamanho: use preço 0", 422);
    }
    Ok(())
}

pub fn link_bounds(group_name: &str, min: i64, max: i64) -> Result<()> {
    if min < 0 || !(1..=99).contains(&max) {
        return fail(format!("Mínimo e máximo inválidos em ‘{group_name}’"));
    }
    if max < min {
        return fail_with(
            format!("O máximo de ‘{group_name}’ deve ser maior ou igual ao mínimo"),
            422,
        );
    }
    Ok(())
}

pub fn group(g: &Group) -> Result<()> {
    length(&g.name, 1, 80, "O nome do grupo deve ter de 1 a 80 caracteres")?;
    member(&g.kind, &GROUP_TYPES, "Tipo de grupo inválido")?;
    code(&g.external_code)?;
    status(&g.status)
}

/// An option within a group of type `kind` (fractions only on sizes, item links only in combos).
pub fn option(kind: &str, o: &MenuOption, size_prices: usize) -> Result<()> {
    prices(o.price_cents, o.original_price_cents)?;
    status(&o.status)?;
    code(&o.external_code)?;
    if !(1..=99).contains(&o.max_quantity) {
        return fail("Quantidade máxima inválida");
    }
    match &o.fractions {
        Some(_) if kind != "size" => return fail_with("Frações só valem para opções de tamanho", 422),
        Some(f) if f.is_empty() || f.iter().any(|n| !(1..=4).contains(n)) => {
            return fail("Frações inválidas: use números de 1 a 4")
        }
        None if kind == "size" => return fail_with("Informe quantos sabores cada tamanho aceita", 422),
        _ => {}
    }
    if size_prices > 0 && kind != "topping" {
        return fail_with("Preços por tamanho só valem para sabores", 422);
    }
    if o.item_id.is_some() && kind != "combo_main" {
        return fail_with(
            "Itens do cardápio só podem ser opções do grupo principal de um combo",
            422,
        );
    }
    Ok(())
}

pub fn settings(s: &MenuSettings) -> Result<()> {
    member(&s.pizza_pricing, &PIZZA_PRICING, "Regra de preço da pizza inválida")?;
    if !(0..=500).contains(&s.notes_max_length) {
        return fail("Limite de observação inválido");
    }
    validate_timezone(&s.timezone)
}

/// Accent- and case-insensitive key for names (`Açaí` = `acai`).
pub fn fold(text: &str) -> String {
    text.trim()
        .to_lowercase()
        .chars()
        .map(|c| match c {
            'á' | 'à' | 'â' | 'ã' | 'ä' => 'a',
            'é' | 'è' | 'ê' | 'ë' => 'e',
            'í' | 'ì' | 'î' | 'ï' => 'i',
            'ó' | 'ò' | 'ô' | 'õ' | 'ö' => 'o',
            'ú' | 'ù' | 'û' | 'ü' => 'u',
            'ç' => 'c',
            other => other,
        })
        .collect()
}
