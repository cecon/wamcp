//! The order calculator: group min/max, membership, availability, max_quantity, notes, quantities
//! and the line breakdown of default items.
mod menu_support;

use menu_support::{pick, request, Rows};
use wamcp_server::domain::error::Error;
use wamcp_server::domain::menu::quote::quote;
use wamcp_server::domain::menu::{Choice, Menu, MenuSettings, Quote};

struct Burger {
    rows: Rows,
    item: i64,
    coca: i64,
    guarana: i64,
    bacon: i64,
    cheddar: i64,
    category: i64,
}

fn burger() -> Burger {
    let mut rows = Rows::default();
    let category = rows.category("Lanches", "default");
    let item = rows.item(category, "X-Burger", "default", 2990);
    rows.item_mut(item).external_code = Some("XB01".into());
    let drinks = rows.group("Escolha a bebida", "offer_unit");
    let coca = rows.option(drinks, "Coca-Cola", 0);
    let guarana = rows.option(drinks, "Guaraná", 0);
    let extras = rows.group("Adicionais", "ingredients");
    let bacon = rows.option(extras, "Bacon", 400);
    rows.option_mut(bacon).max_quantity = 2;
    let cheddar = rows.option(extras, "Cheddar", 350);
    rows.link(item, drinks, 1, 1);
    rows.link(item, extras, 0, 3);
    Burger {
        rows,
        item,
        coca,
        guarana,
        bacon,
        cheddar,
        category,
    }
}

fn run(menu: &Menu, item: i64, choices: Vec<Choice>) -> Quote {
    quote(menu, &request(item, choices)).expect("quote")
}

fn settings() -> MenuSettings {
    MenuSettings::default()
}

/// Lines always add up to the unit price.
fn balanced(quote: &Quote) -> bool {
    quote.lines.iter().map(|l| l.quantity * l.unit_price_cents).sum::<i64>() == quote.unit_price_cents
}

#[test]
fn a_valid_order_is_priced_with_one_line_per_choice() {
    let b = burger();
    let menu = b.rows.menu(&settings());
    let mut req = request(b.item, vec![pick(b.coca, 1), pick(b.bacon, 2), pick(b.cheddar, 1)]);
    req.quantity = 2;
    req.notes = Some("sem cebola".into());
    let q = quote(&menu, &req).unwrap();
    assert!(q.errors.is_empty(), "{:?}", q.errors);
    assert_eq!((q.unit_price_cents, q.total_price_cents), (2990 + 800 + 350, 2 * 4140));
    assert_eq!(q.lines.len(), 4);
    assert_eq!(q.lines[0].name, "X-Burger");
    assert_eq!(q.lines[0].external_code.as_deref(), Some("XB01"));
    assert_eq!((q.lines[2].name.as_str(), q.lines[2].quantity), ("Bacon", 2));
    assert!(q.lines[1].external_code.is_some(), "option PDV code");
    assert!(balanced(&q));
}

#[test]
fn required_groups_and_maximums_are_reported_in_portuguese() {
    let b = burger();
    let menu = b.rows.menu(&settings());
    let q = run(&menu, b.item, vec![]);
    assert_eq!(q.errors, vec!["Escolha 1 opção em ‘Escolha a bebida’"]);
    assert_eq!(q.unit_price_cents, 2990);

    let too_many = vec![pick(b.coca, 1), pick(b.bacon, 2), pick(b.cheddar, 2)];
    let q = run(&menu, b.item, too_many);
    assert_eq!(
        q.errors,
        vec!["Máximo de 1 de ‘Cheddar’", "Máximo de 3 em ‘Adicionais’"]
    );

    let two_drinks = run(&menu, b.item, vec![pick(b.coca, 1), pick(b.guarana, 1)]);
    assert_eq!(two_drinks.errors, vec!["Máximo de 1 em ‘Escolha a bebida’"]);
}

#[test]
fn options_must_belong_to_the_item_be_available_and_have_valid_quantities() {
    let mut b = burger();
    b.rows.option_mut(b.guarana).status = "unavailable".into();
    let menu = b.rows.menu(&settings());
    let q = run(&menu, b.item, vec![pick(999, 1), pick(b.coca, 1)]);
    assert_eq!(q.errors, vec!["A opção 999 não pertence a ‘X-Burger’"]);
    let q = run(&menu, b.item, vec![pick(b.guarana, 1)]);
    assert_eq!(q.errors, vec!["‘Guaraná’ não está disponível agora"]);
    let q = run(&menu, b.item, vec![pick(b.coca, 0)]);
    assert_eq!(
        q.errors,
        vec![
            "Quantidade inválida em ‘Coca-Cola’",
            "Escolha 1 opção em ‘Escolha a bebida’"
        ]
    );
    let nested = Choice {
        option_id: b.coca,
        quantity: 1,
        choices: vec![pick(b.bacon, 1)],
    };
    let q = run(&menu, b.item, vec![nested]);
    assert_eq!(q.errors, vec!["‘Coca-Cola’ não aceita complementos"]);
}

#[test]
fn a_paused_group_makes_its_options_unavailable() {
    let mut b = burger();
    let group = b.rows.rows.groups.iter_mut().find(|g| g.name == "Adicionais").unwrap();
    group.status = "unavailable".into();
    let q = run(
        &b.rows.menu(&settings()),
        b.item,
        vec![pick(b.coca, 1), pick(b.bacon, 1)],
    );
    assert_eq!(q.errors, vec!["‘Bacon’ não está disponível agora"]);
}

#[test]
fn unavailable_items_paused_categories_and_closed_shifts_are_reported() {
    let mut b = burger();
    b.rows.item_mut(b.item).status = "unavailable".into();
    let q = run(&b.rows.menu(&settings()), b.item, vec![pick(b.coca, 1)]);
    assert_eq!(q.errors, vec!["‘X-Burger’ não está disponível agora"]);

    let mut b = burger();
    b.rows.rows.categories[0].status = "unavailable".into();
    let menu = b.rows.menu(&settings());
    assert!(!menu.item(b.item).unwrap().available_now);
    assert_eq!(b.category, menu.categories[0].category.id);

    let mut b = burger();
    // Friday 09:00 in São Paulo: a dinner shift is closed, a morning shift open.
    b.rows.item_mut(b.item).shifts = vec![wamcp_server::domain::menu::Shift {
        days: vec![5],
        start: "18:00".into(),
        end: "23:00".into(),
    }];
    let q = run(&b.rows.menu(&settings()), b.item, vec![pick(b.coca, 1)]);
    assert_eq!(q.errors, vec!["‘X-Burger’ não está disponível agora"]);
    b.rows.item_mut(b.item).shifts[0].start = "08:00".into();
    assert!(run(&b.rows.menu(&settings()), b.item, vec![pick(b.coca, 1)])
        .errors
        .is_empty());
}

#[test]
fn notes_and_quantities_are_bounded() {
    let b = burger();
    let menu = b.rows.menu(&settings());
    let mut req = request(b.item, vec![pick(b.coca, 1)]);
    req.notes = Some("x".repeat(141));
    req.quantity = 0;
    let q = quote(&menu, &req).unwrap();
    assert_eq!(
        q.errors,
        vec![
            "A quantidade deve ser de 1 a 99",
            "A observação deve ter até 140 caracteres"
        ]
    );
    assert_eq!(q.total_price_cents, 0);
    req.notes = Some("x".repeat(140));
    req.quantity = 99;
    let q = quote(&menu, &req).unwrap();
    assert!(q.errors.is_empty());
    assert_eq!(q.total_price_cents, 99 * 2990);

    let custom = MenuSettings {
        notes_max_length: 5,
        ..settings()
    };
    let mut req = request(b.item, vec![pick(b.coca, 1)]);
    req.notes = Some("sem sal".into());
    let q = quote(&b.rows.menu(&custom), &req).unwrap();
    assert_eq!(q.errors, vec!["A observação deve ter até 5 caracteres"]);
}

#[test]
fn ranges_use_at_least_and_plural_messages() {
    let mut rows = Rows::default();
    let category = rows.category("Açaí", "default");
    let item = rows.item(category, "Açaí 500 ml", "default", 2200);
    let toppings = rows.group("Acompanhamentos", "ingredients");
    let granola = rows.option(toppings, "Granola", 0);
    let milk = rows.option(toppings, "Leite em pó", 200);
    let strawberry = rows.option(toppings, "Morango", 350);
    rows.link(item, toppings, 1, 2);
    let sauces = rows.group("Caldas", "ingredients");
    let honey = rows.option(sauces, "Mel", 0);
    rows.link(item, sauces, 2, 2);
    rows.option_mut(honey).max_quantity = 2;
    let menu = rows.menu(&settings());
    let q = run(&menu, item, vec![]);
    assert_eq!(
        q.errors,
        vec![
            "Escolha pelo menos 1 em ‘Acompanhamentos’",
            "Escolha 2 opções em ‘Caldas’"
        ]
    );
    let q = run(&menu, item, vec![pick(milk, 1), pick(strawberry, 1), pick(honey, 2)]);
    assert!(q.errors.is_empty(), "{:?}", q.errors);
    assert_eq!(q.unit_price_cents, 2200 + 200 + 350);
    let q = run(
        &menu,
        item,
        vec![pick(granola, 1), pick(milk, 1), pick(strawberry, 1), pick(honey, 2)],
    );
    assert_eq!(q.errors, vec!["Máximo de 2 em ‘Acompanhamentos’"]);
}

#[test]
fn unknown_items_are_not_found() {
    let b = burger();
    match quote(&b.rows.menu(&settings()), &request(4242, vec![])) {
        Err(Error::Helpdesk(e)) => assert_eq!((e.status, e.message.as_str()), (404, "Item não encontrado")),
        other => panic!("{other:?}"),
    }
}
