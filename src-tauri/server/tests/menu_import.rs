//! The iFood converters over captured fixtures: consumer/legacy and Catalog v2 formats, pizza
//! (sizes, fractions, per-size flavour prices, legacy heuristics), normalization and counts.
use serde_json::{json, Value};
use wamcp_server::domain::menu::import::{
    convert, counts, group_key, normalize, ImportCategory, ImportItem, ImportTree,
};

fn fixture(name: &str) -> Value {
    let path = format!("{}/tests/fixtures/ifood/{name}", env!("CARGO_MANIFEST_DIR"));
    serde_json::from_str(&std::fs::read_to_string(path).expect("fixture")).expect("json")
}

fn tree(name: &str) -> ImportTree {
    convert(&[fixture(name)]).expect("menu found")
}

fn item<'a>(tree: &'a ImportTree, name: &str) -> &'a ImportItem {
    tree.categories
        .iter()
        .flat_map(|c| &c.items)
        .find(|i| i.name == name)
        .unwrap_or_else(|| panic!("item {name}"))
}

#[test]
fn legacy_burger_menu_keeps_prices_codes_photos_and_choice_bounds() {
    let tree = tree("burger_legacy.json");
    let names: Vec<&str> = tree.categories.iter().map(|c| c.name.as_str()).collect();
    assert_eq!(names, ["Lanches", "Bebidas"], "empty categories are dropped");
    let burger = item(&tree, "X-Burger");
    assert_eq!((burger.price_cents, burger.original_price_cents), (2990, Some(3490)));
    assert_eq!(burger.external_code.as_deref(), Some("XB01"));
    assert_eq!(burger.ifood_id.as_deref(), Some("it-xburger"));
    assert_eq!(
        burger.image_url.as_deref(),
        Some("https://static-images.ifood.com.br/image/upload/t_high/pratos/202401/xburger.jpg")
    );
    assert_eq!(
        burger.description.as_deref(),
        Some("Pão brioche, hambúrguer 150 g, queijo e salada")
    );
    let drink = &burger.groups[0];
    assert_eq!(
        (drink.name.as_str(), drink.kind.as_str(), drink.min, drink.max),
        ("Escolha a bebida", "offer_unit", 1, 1)
    );
    let extras = &burger.groups[1];
    assert_eq!((extras.kind.as_str(), extras.min, extras.max), ("ingredients", 0, 3));
    let prices: Vec<i64> = extras.options.iter().map(|o| o.price_cents).collect();
    assert_eq!(prices, [400, 350, 250]);
    assert_eq!(extras.options[0].external_code.as_deref(), Some("BAC"));
    assert!(extras.options[2].image_url.is_some());
    let juice = item(&tree, "Suco de laranja 500 ml");
    assert_eq!(juice.price_cents, 1200, "unitMinPrice when unitPrice is 0");
    assert_eq!(tree.pizza_pricing, "greater");
    let c = counts(&tree);
    assert_eq!((c.categories, c.items, c.groups, c.options, c.images), (2, 3, 2, 5, 2));
}

#[test]
fn catalog_v2_acai_resolves_products_groups_options_and_context_codes() {
    let tree = tree("acai_v2.json");
    let category = &tree.categories[0];
    assert_eq!(
        (category.name.as_str(), category.external_code.as_deref()),
        ("Açaí", Some("ACAI"))
    );
    let acai = item(&tree, "Açaí 500 ml");
    assert_eq!((acai.price_cents, acai.original_price_cents), (2200, Some(2500)));
    assert_eq!(
        acai.external_code.as_deref(),
        Some("AC500"),
        "from the DEFAULT context modifier"
    );
    assert_eq!(acai.product_code.as_deref(), Some("P-AC500"));
    assert_eq!(
        (acai.serving.as_str(), acai.dietary.clone()),
        ("serves_1", vec!["vegan".to_string()])
    );
    assert_eq!(acai.ean.as_deref(), Some("7891234567895"));
    assert_eq!(acai.shifts.len(), 1);
    assert_eq!(
        (acai.shifts[0].start.as_str(), acai.shifts[0].end.as_str()),
        ("14:00", "23:00")
    );
    assert_eq!(acai.shifts[0].days, [1, 2, 3, 4, 5, 6]);
    let group = &acai.groups[0];
    assert_eq!((group.name.as_str(), group.min, group.max), ("Acompanhamentos", 1, 2));
    assert_eq!(group.external_code.as_deref(), Some("G-ACOMP"));
    let options: Vec<(&str, i64, Option<&str>, &str)> = group
        .options
        .iter()
        .map(|o| {
            (
                o.name.as_str(),
                o.price_cents,
                o.external_code.as_deref(),
                o.status.as_str(),
            )
        })
        .collect();
    assert_eq!(
        options,
        [
            ("Granola", 0, Some("P-GRA"), "available"),
            ("Leite em pó", 200, Some("O-LEI"), "available"),
            ("Morango", 350, Some("O-MOR"), "unavailable"),
        ]
    );
    let small = item(&tree, "Açaí 300 ml");
    assert_eq!(small.status, "unavailable");
    assert_eq!(
        small.image_url.as_deref(),
        Some("https://static-images.ifood.com.br/image/upload/t_high/pratos/acai300.jpg")
    );
    let c = counts(&tree);
    assert_eq!(
        (c.items, c.groups, c.options, c.images),
        (2, 1, 3, 2),
        "shared group counted once"
    );
}

#[test]
fn catalog_v2_pizza_has_sizes_fractions_and_per_size_flavour_prices() {
    let tree = tree("pizzaria_v2.json");
    let pizzas = &tree.categories[0];
    assert_eq!(pizzas.template, "pizza");
    let pizza = &pizzas.items[0];
    assert_eq!((pizza.price_cents, pizza.external_code.as_deref()), (0, Some("PZ")));
    let kinds: Vec<(&str, i64, i64)> = pizza.groups.iter().map(|g| (g.kind.as_str(), g.min, g.max)).collect();
    assert_eq!(
        kinds,
        [("size", 1, 1), ("crust", 1, 1), ("edge", 0, 1), ("topping", 1, 2)]
    );
    let sizes = &pizza.groups[0].options;
    assert_eq!(sizes[0].fractions, Some(vec![1]));
    assert_eq!(sizes[1].fractions, Some(vec![1, 2]));
    assert_eq!(sizes[1].ifood_id.as_deref(), Some("opt-grande"));
    let calabresa = &pizza.groups[3].options[0];
    assert_eq!(
        calabresa.external_code.as_deref(),
        Some("SAB-CAL"),
        "DEFAULT context code"
    );
    let prices: Vec<(&str, i64)> = calabresa
        .size_prices
        .iter()
        .map(|p| (p.size.as_str(), p.price_cents))
        .collect();
    assert_eq!(prices, [("opt-broto", 3000), ("opt-grande", 5000)]);
    assert_eq!(pizza.groups[3].options[2].size_prices[1].price_cents, 5890);
    assert!(calabresa
        .image_url
        .as_deref()
        .unwrap()
        .ends_with("/pratos/calabresa.jpg"));
    assert_eq!(pizza.groups[2].options[0].price_cents, 800);
    assert_eq!(item(&tree, "Refrigerante 2 L").price_cents, 900);
}

#[test]
fn legacy_pizzas_are_detected_from_size_and_flavour_choices() {
    let tree = tree("pizzaria_legacy.json");
    let salty = &tree.categories[0];
    assert_eq!(salty.template, "pizza");
    let monte = item(&tree, "Monte sua pizza");
    let kinds: Vec<(&str, i64, i64)> = monte.groups.iter().map(|g| (g.kind.as_str(), g.min, g.max)).collect();
    assert_eq!(
        kinds,
        [("size", 1, 1), ("topping", 1, 2), ("crust", 1, 1), ("edge", 0, 1)],
        "flavour choices merged into one topping group"
    );
    let toppings = &monte.groups[1].options;
    assert_eq!(
        toppings.len(),
        2,
        "the same flavours of the 1st and 2nd choice are merged"
    );
    assert_eq!(monte.groups[0].options[1].fractions, Some(vec![1, 2]));
    assert_eq!(monte.groups[0].options[1].price_cents, 1000);
    let calabresa = item(&tree, "Calabresa");
    let sizes: Vec<i64> = calabresa.groups[0].options.iter().map(|o| o.price_cents).collect();
    assert_eq!(sizes, [4500, 5500], "a zero size takes the flavour item's price");
    assert_eq!(calabresa.groups[1].options[0].name, "Calabresa");
    assert_eq!(calabresa.price_cents, 0);
    let sweet = &tree.categories[1];
    assert_eq!(sweet.template, "default", "only one pizza category is kept");
}

#[test]
fn menus_are_found_inside_next_data_and_unknown_payloads_are_ignored() {
    let legacy = fixture("burger_legacy.json");
    let next =
        json!({ "props": { "pageProps": { "initialState": { "restaurant": { "menu": legacy["data"]["menu"] } } } } });
    let payloads = vec![json!({ "user": { "id": 1 } }), json!([1, 2, 3]), next];
    let tree = convert(&payloads).expect("found in __NEXT_DATA__");
    assert_eq!(tree.categories.len(), 2);
    assert!(convert(&[json!({ "data": { "menu": [] } })]).is_none());
    assert!(convert(&[json!([{ "name": "x", "items": [] }])]).is_none());
    assert!(convert(&[]).is_none());
    let wrapped = json!({ "categories": fixture("acai_v2.json") });
    assert_eq!(convert(&[wrapped]).expect("wrapped v2").categories[0].name, "Açaí");
}

#[test]
fn normalization_enforces_lengths_prices_bounds_and_unique_names() {
    let long = "N".repeat(200);
    let raw = ImportTree {
        pizza_pricing: "weird".into(),
        categories: vec![
            ImportCategory {
                name: "Lanches".into(),
                template: "combo".into(),
                items: vec![ImportItem {
                    name: long.clone(),
                    price_cents: -5,
                    original_price_cents: Some(-1),
                    serving: "serves_99".into(),
                    dietary: vec!["vegan".into(), "keto".into()],
                    ean: Some("abc".into()),
                    external_code: Some("C".repeat(80)),
                    status: "PAUSED".into(),
                    groups: vec![serde_json::from_value(json!({ "name": "", "type": "nope", "min": 5, "max": 2, "options": [{ "name": "", "price_cents": 10, "original_price_cents": 5, "max_quantity": 0, "fractions": [1], "size_prices": [{ "size": "a", "price_cents": 1 }] }] })).unwrap()],
                    ..ImportItem::default()
                }],
                ..ImportCategory::default()
            },
            ImportCategory {
                name: "lanches".into(),
                template: "other".into(),
                items: vec![ImportItem { name: "B".into(), ..ImportItem::default() }],
                ..ImportCategory::default()
            },
        ],
    };
    let tree = normalize(raw);
    assert_eq!(tree.pizza_pricing, "greater");
    let first = &tree.categories[0];
    assert_eq!((first.template.as_str(), first.status.as_str()), ("combo", "available"));
    assert_eq!(tree.categories[1].name, "lanches (2)");
    assert_eq!(tree.categories[1].template, "default");
    let item = &first.items[0];
    assert_eq!(item.name.chars().count(), 120);
    assert_eq!((item.price_cents, item.original_price_cents), (0, None));
    assert_eq!(
        (item.serving.as_str(), item.dietary.clone()),
        ("not_applicable", vec!["vegan".to_string()])
    );
    assert_eq!(
        (item.ean.clone(), item.external_code.as_ref().map(String::len)),
        (None, Some(60))
    );
    assert_eq!(item.status, "available");
    let group = &item.groups[0];
    assert_eq!(
        (group.name.as_str(), group.kind.as_str(), group.min, group.max),
        ("Sem nome", "ingredients", 5, 5)
    );
    let option = &group.options[0];
    assert_eq!(
        (option.name.as_str(), option.original_price_cents, option.max_quantity),
        ("Sem nome", None, 1)
    );
    assert!(option.fractions.is_none() && option.size_prices.is_empty());
    assert!(group_key(group).starts_with("sem nome|ingredients|"));
}
