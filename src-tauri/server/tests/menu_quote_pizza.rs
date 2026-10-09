//! Pizza (size, flavours by fractions, `greater`/`average` pricing rounded up) and combo (nested
//! choices of the chosen item) quotes.
mod menu_support;

use menu_support::{pick, request, Rows};
use wamcp_server::domain::menu::quote::quote;
use wamcp_server::domain::menu::{Choice, MenuSettings, Quote};

struct Pizza {
    rows: Rows,
    item: i64,
    broto: i64,
    grande: i64,
    crust: i64,
    edge: i64,
    calabresa: i64,
    portuguesa: i64,
    mussarela: i64,
}

fn pizza() -> Pizza {
    let mut rows = Rows::default();
    let category = rows.category("Pizzas", "pizza");
    let item = rows.item(category, "Pizza", "pizza", 0);
    let sizes = rows.group("Tamanho", "size");
    let broto = rows.option(sizes, "Broto", 0);
    rows.option_mut(broto).fractions = Some(vec![1]);
    let grande = rows.option(sizes, "Grande", 500);
    rows.option_mut(grande).fractions = Some(vec![1, 2]);
    let crusts = rows.group("Massa", "crust");
    let crust = rows.option(crusts, "Tradicional", 0);
    let edges = rows.group("Borda", "edge");
    let edge = rows.option(edges, "Catupiry", 800);
    let toppings = rows.group("Sabores", "topping");
    let calabresa = rows.option(toppings, "Calabresa", 3000);
    let portuguesa = rows.option(toppings, "Portuguesa", 3500);
    let mussarela = rows.option(toppings, "Mussarela", 4001);
    rows.option_mut(calabresa).max_quantity = 2;
    rows.size_price(calabresa, broto, 3000);
    rows.size_price(calabresa, grande, 5000);
    rows.size_price(portuguesa, broto, 3500);
    rows.size_price(portuguesa, grande, 5890);
    rows.link(item, sizes, 1, 1);
    rows.link(item, crusts, 1, 1);
    rows.link(item, edges, 0, 1);
    rows.link(item, toppings, 1, 2);
    Pizza {
        rows,
        item,
        broto,
        grande,
        crust,
        edge,
        calabresa,
        portuguesa,
        mussarela,
    }
}

fn priced(rule: &str, p: &Pizza, choices: Vec<Choice>) -> Quote {
    let settings = MenuSettings {
        pizza_pricing: rule.into(),
        ..MenuSettings::default()
    };
    quote(&p.rows.menu(&settings), &request(p.item, choices)).unwrap()
}

fn balanced(quote: &Quote) -> bool {
    quote.lines.iter().map(|l| l.quantity * l.unit_price_cents).sum::<i64>() == quote.unit_price_cents
}

#[test]
fn greater_charges_the_most_expensive_flavour_in_the_chosen_size() {
    let p = pizza();
    let half = vec![
        pick(p.grande, 1),
        pick(p.crust, 1),
        pick(p.edge, 1),
        pick(p.calabresa, 1),
        pick(p.portuguesa, 1),
    ];
    let q = priced("greater", &p, half);
    assert!(q.errors.is_empty(), "{:?}", q.errors);
    assert_eq!(q.unit_price_cents, 500 + 800 + 5890);
    let names: Vec<&str> = q.lines.iter().map(|l| l.name.as_str()).collect();
    assert_eq!(
        names,
        [
            "Pizza",
            "Grande",
            "Tradicional",
            "Catupiry",
            "1/2 Calabresa",
            "1/2 Portuguesa"
        ]
    );
    assert_eq!((q.lines[4].unit_price_cents, q.lines[5].unit_price_cents), (2945, 2945));
    assert!(balanced(&q));
}

#[test]
fn average_rounds_up_to_the_cent_and_falls_back_to_the_flavour_price() {
    let p = pizza();
    let q = priced(
        "average",
        &p,
        vec![
            pick(p.grande, 1),
            pick(p.crust, 1),
            pick(p.calabresa, 1),
            pick(p.portuguesa, 1),
        ],
    );
    assert_eq!(q.unit_price_cents, 500 + 5445);
    // Mussarela has no per-size price: its own 40,01 is used; (58,90 + 40,01) / 2 = 49,455 → 49,46.
    let q = priced(
        "average",
        &p,
        vec![
            pick(p.grande, 1),
            pick(p.crust, 1),
            pick(p.portuguesa, 1),
            pick(p.mussarela, 1),
        ],
    );
    assert_eq!(q.unit_price_cents, 500 + 4946);
    assert!(balanced(&q));
}

#[test]
fn the_size_limits_how_many_flavours_fit() {
    let p = pizza();
    let q = priced(
        "greater",
        &p,
        vec![
            pick(p.broto, 1),
            pick(p.crust, 1),
            pick(p.calabresa, 1),
            pick(p.portuguesa, 1),
        ],
    );
    assert_eq!(q.errors, vec!["O tamanho ‘Broto’ não aceita 2 sabores"]);
    let whole = priced(
        "greater",
        &p,
        vec![pick(p.broto, 1), pick(p.crust, 1), pick(p.calabresa, 1)],
    );
    assert!(whole.errors.is_empty());
    assert_eq!(whole.unit_price_cents, 3000);
    assert_eq!(whole.lines.last().unwrap().name, "Calabresa");
    // The same flavour twice fills both halves of the large pizza.
    let double = priced(
        "average",
        &p,
        vec![pick(p.grande, 1), pick(p.crust, 1), pick(p.calabresa, 2)],
    );
    assert!(double.errors.is_empty(), "{:?}", double.errors);
    assert_eq!(double.unit_price_cents, 500 + 5000);
    assert_eq!(double.lines.last().unwrap().name, "2/2 Calabresa");
    assert!(balanced(&double));
}

#[test]
fn a_pizza_without_size_or_flavour_is_incomplete() {
    let p = pizza();
    let q = priced("greater", &p, vec![pick(p.crust, 1)]);
    assert_eq!(
        q.errors,
        vec!["Escolha 1 opção em ‘Tamanho’", "Escolha pelo menos 1 em ‘Sabores’"]
    );
    assert_eq!(q.unit_price_cents, 0);
}

struct Combo {
    rows: Rows,
    combo: i64,
    burger_option: i64,
    salad_option: i64,
    coca: i64,
    bacon: i64,
}

fn combo() -> Combo {
    let mut rows = Rows::default();
    let snacks = rows.category("Lanches", "default");
    let burger = rows.item(snacks, "X-Burger", "default", 2990);
    let salad = rows.item(snacks, "X-Salada", "default", 2750);
    let drinks = rows.group("Escolha a bebida", "offer_unit");
    let coca = rows.option(drinks, "Coca-Cola", 0);
    let extras = rows.group("Adicionais", "ingredients");
    let bacon = rows.option(extras, "Bacon", 400);
    rows.link(burger, drinks, 1, 1);
    rows.link(burger, extras, 0, 3);
    let combos = rows.category("Combos", "combo");
    let combo = rows.item(combos, "Combo X", "combo", 3990);
    let main = rows.group("Escolha o item principal", "combo_main");
    let burger_option = rows.option(main, "X-Burger", 0);
    rows.option_mut(burger_option).item_id = Some(burger);
    let salad_option = rows.option(main, "X-Salada", 200);
    rows.option_mut(salad_option).item_id = Some(salad);
    rows.link(combo, main, 1, 1);
    Combo {
        rows,
        combo,
        burger_option,
        salad_option,
        coca,
        bacon,
    }
}

fn with(option_id: i64, choices: Vec<Choice>) -> Choice {
    Choice {
        option_id,
        quantity: 1,
        choices,
    }
}

#[test]
fn combos_price_the_surcharge_and_the_chosen_items_complements() {
    let c = combo();
    let menu = c.rows.menu(&MenuSettings::default());
    let chosen = with(c.burger_option, vec![pick(c.coca, 1), pick(c.bacon, 1)]);
    let q = quote(&menu, &request(c.combo, vec![chosen])).unwrap();
    assert!(q.errors.is_empty(), "{:?}", q.errors);
    assert_eq!(q.unit_price_cents, 3990 + 400);
    assert!(balanced(&q));
    let names: Vec<&str> = q.lines.iter().map(|l| l.name.as_str()).collect();
    assert_eq!(names, ["Combo X", "X-Burger", "Coca-Cola", "Bacon"]);

    let salad = quote(&menu, &request(c.combo, vec![with(c.salad_option, vec![])])).unwrap();
    assert_eq!(salad.unit_price_cents, 3990 + 200);

    let missing_drink = quote(&menu, &request(c.combo, vec![with(c.burger_option, vec![])])).unwrap();
    assert_eq!(missing_drink.errors, vec!["Escolha 1 opção em ‘Escolha a bebida’"]);
}

#[test]
fn nested_items_must_exist_be_available_and_not_nest_too_deep() {
    let mut c = combo();
    c.rows.option_mut(c.salad_option).item_id = Some(9999);
    let menu = c.rows.menu(&MenuSettings::default());
    let q = quote(&menu, &request(c.combo, vec![with(c.salad_option, vec![])])).unwrap();
    assert_eq!(q.errors, vec!["‘X-Salada’ não está disponível agora"]);

    // combo → item → item → item: the third level of item options is refused.
    let mut rows = Rows::default();
    let category = rows.category("Combos", "combo");
    let top = rows.item(category, "Combo", "combo", 1000);
    let middle = rows.item(category, "Meio", "default", 0);
    let bottom = rows.item(category, "Fundo", "default", 0);
    let leaf = rows.item(category, "Folha", "default", 0);
    let mut chain = Vec::new();
    for (owner, target) in [(top, middle), (middle, bottom), (bottom, leaf)] {
        let group = rows.group("Nível", "combo_main");
        let option = rows.option(group, "Próximo", 0);
        rows.option_mut(option).item_id = Some(target);
        rows.link(owner, group, 1, 1);
        chain.push(option);
    }
    let deepest = with(chain[0], vec![with(chain[1], vec![with(chain[2], vec![])])]);
    let q = quote(&rows.menu(&MenuSettings::default()), &request(top, vec![deepest])).unwrap();
    assert_eq!(q.errors, vec!["Complementos aninhados demais"]);
}
