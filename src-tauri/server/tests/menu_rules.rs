//! Validation of catalog entries (lengths, enums, prices, shifts, links, options, settings).
use wamcp_server::domain::error::Error;
use wamcp_server::domain::menu::rules::{self, fold};
use wamcp_server::domain::menu::{Category, Group, Item, MenuOption, MenuSettings, Product, Shift};

fn shift(days: &[i64], start: &str, end: &str) -> Shift {
    Shift {
        days: days.to_vec(),
        start: start.into(),
        end: end.into(),
    }
}

fn message<T: std::fmt::Debug>(result: Result<T, Error>) -> (u16, String) {
    match result {
        Err(Error::Helpdesk(e)) => (e.status, e.message),
        other => panic!("expected a business error, got {other:?}"),
    }
}

#[test]
fn entries_are_validated_with_status_codes() {
    let category = Category {
        name: "Lanches".into(),
        template: "default".into(),
        status: "available".into(),
        ..Category::default()
    };
    assert!(rules::category(&category).is_ok());
    let bad = |c: Category| message(rules::category(&c));
    assert_eq!(
        bad(Category {
            name: String::new(),
            ..category.clone()
        })
        .0,
        400
    );
    assert_eq!(
        bad(Category {
            template: "x".into(),
            ..category.clone()
        })
        .1,
        "Modelo de categoria inválido"
    );
    assert_eq!(
        bad(Category {
            status: "paused".into(),
            ..category.clone()
        })
        .0,
        400
    );
    assert_eq!(
        bad(Category {
            external_code: Some("x".repeat(61)),
            ..category
        })
        .0,
        400
    );

    let product = Product {
        name: "X".into(),
        serving: "serves_2".into(),
        dietary: vec!["vegan".into()],
        ..Product::default()
    };
    assert!(rules::product(&product).is_ok());
    let bad = |p: Product| message(rules::product(&p)).1;
    assert_eq!(
        bad(Product {
            ean: Some("12a".into()),
            ..product.clone()
        }),
        "O EAN deve ter até 14 dígitos"
    );
    assert_eq!(
        bad(Product {
            serving: "serves_9".into(),
            ..product.clone()
        }),
        "Porção inválida"
    );
    assert_eq!(
        bad(Product {
            dietary: vec!["keto".into()],
            ..product.clone()
        }),
        "Restrição alimentar inválida"
    );
    assert_eq!(
        bad(Product {
            slices: Some(0),
            ..product.clone()
        }),
        "Número de fatias inválido"
    );
    assert_eq!(
        bad(Product {
            description: Some("d".repeat(1001)),
            ..product
        }),
        "A descrição deve ter até 1000 caracteres"
    );

    let item = Item {
        kind: "default".into(),
        status: "available".into(),
        price_cents: 1000,
        ..Item::default()
    };
    assert!(rules::item(&item).is_ok());
    let bad = |i: Item| message(rules::item(&i));
    assert_eq!(
        bad(Item {
            original_price_cents: Some(1000),
            ..item.clone()
        }),
        (422, "O preço original deve ser maior que o preço".into())
    );
    assert_eq!(
        bad(Item {
            price_cents: -1,
            ..item.clone()
        })
        .0,
        400
    );
    assert_eq!(
        bad(Item {
            kind: "pizza".into(),
            ..item.clone()
        })
        .0,
        422
    );
    assert_eq!(
        bad(Item {
            shifts: vec![shift(&[7], "10:00", "11:00")],
            ..item.clone()
        })
        .0,
        400
    );
    assert_eq!(
        bad(Item {
            shifts: vec![shift(&[], "10:00", "11:00")],
            ..item.clone()
        })
        .0,
        400
    );
    assert_eq!(
        bad(Item {
            shifts: vec![shift(&[1], "10:00", "11:00"); 21],
            ..item
        })
        .1,
        "Horários demais"
    );

    assert_eq!(message(rules::link_bounds("Bebida", 2, 1)).0, 422);
    assert_eq!(message(rules::link_bounds("Bebida", 0, 0)).0, 400);
    assert!(rules::link_bounds("Bebida", 0, 3).is_ok());

    let group = Group {
        name: "G".into(),
        kind: "size".into(),
        status: "available".into(),
        ..Group::default()
    };
    assert!(rules::group(&group).is_ok());
    assert_eq!(
        message(rules::group(&Group {
            kind: "x".into(),
            ..group
        }))
        .1,
        "Tipo de grupo inválido"
    );

    let option = MenuOption {
        status: "available".into(),
        max_quantity: 1,
        ..MenuOption::default()
    };
    let sized = MenuOption {
        fractions: Some(vec![1, 2]),
        ..option.clone()
    };
    assert!(rules::option("size", &sized, 0).is_ok());
    assert_eq!(
        message(rules::option("size", &option, 0)).0,
        422,
        "sizes need fractions"
    );
    assert_eq!(message(rules::option("ingredients", &sized, 0)).0, 422);
    assert_eq!(
        message(rules::option(
            "size",
            &MenuOption {
                fractions: Some(vec![5]),
                ..option.clone()
            },
            0
        ))
        .0,
        400
    );
    assert_eq!(
        message(rules::option("ingredients", &option, 1)).0,
        422,
        "size prices only on toppings"
    );
    assert!(rules::option("topping", &option, 2).is_ok());
    assert_eq!(
        message(rules::option(
            "ingredients",
            &MenuOption {
                item_id: Some(1),
                ..option.clone()
            },
            0
        ))
        .0,
        422
    );
    assert_eq!(
        message(rules::option(
            "ingredients",
            &MenuOption {
                max_quantity: 0,
                ..option
            },
            0
        ))
        .0,
        400
    );

    assert!(rules::settings(&MenuSettings::default()).is_ok());
    let settings = MenuSettings::default();
    assert_eq!(
        message(rules::settings(&MenuSettings {
            pizza_pricing: "x".into(),
            ..settings.clone()
        }))
        .0,
        400
    );
    assert_eq!(
        message(rules::settings(&MenuSettings {
            notes_max_length: 501,
            ..settings.clone()
        }))
        .0,
        400
    );
    assert_eq!(
        message(rules::settings(&MenuSettings {
            timezone: "Mars/Base".into(),
            ..settings
        }))
        .1,
        "Fuso horário inválido"
    );
    assert_eq!(fold(" Açaí Pão "), "acai pao");
}
