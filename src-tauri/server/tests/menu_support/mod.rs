//! Builds catalog rows by hand for the pure quote and assembly tests.
#![allow(dead_code)]
use wamcp_server::domain::menu::assemble::Assembler;
use wamcp_server::domain::menu::{
    Category, Choice, Group, Item, Link, Menu, MenuOption, MenuRows, MenuSettings, Product, QuoteRequest, SizePrice,
};

/// 2027-01-15 12:00 UTC (a Friday, 09:00 in São Paulo).
pub const NOON: i64 = 1_800_014_400;

#[derive(Default)]
pub struct Rows {
    pub rows: MenuRows,
    next: i64,
}

impl Rows {
    fn id(&mut self) -> i64 {
        self.next += 1;
        self.next
    }

    pub fn category(&mut self, name: &str, template: &str) -> i64 {
        let id = self.id();
        self.rows.categories.push(Category {
            id,
            name: name.into(),
            template: template.into(),
            status: "available".into(),
            ..Category::default()
        });
        id
    }

    pub fn product(&mut self, name: &str) -> i64 {
        let id = self.id();
        self.rows.products.push(Product {
            id,
            name: name.into(),
            serving: "not_applicable".into(),
            ..Product::default()
        });
        id
    }

    pub fn item(&mut self, category_id: i64, name: &str, kind: &str, price: i64) -> i64 {
        let product_id = self.product(name);
        let id = self.id();
        self.rows.items.push(Item {
            id,
            category_id,
            kind: kind.into(),
            product_id,
            price_cents: price,
            status: "available".into(),
            ..Item::default()
        });
        id
    }

    pub fn group(&mut self, name: &str, kind: &str) -> i64 {
        let id = self.id();
        self.rows.groups.push(Group {
            id,
            name: name.into(),
            kind: kind.into(),
            status: "available".into(),
            ..Group::default()
        });
        id
    }

    pub fn option(&mut self, group_id: i64, name: &str, price: i64) -> i64 {
        let product_id = self.product(name);
        let id = self.id();
        self.rows.options.push(MenuOption {
            id,
            group_id,
            product_id,
            price_cents: price,
            status: "available".into(),
            max_quantity: 1,
            external_code: Some(format!("C{id}")),
            ..MenuOption::default()
        });
        id
    }

    pub fn option_mut(&mut self, id: i64) -> &mut MenuOption {
        self.rows.options.iter_mut().find(|o| o.id == id).expect("option")
    }

    pub fn item_mut(&mut self, id: i64) -> &mut Item {
        self.rows.items.iter_mut().find(|i| i.id == id).expect("item")
    }

    pub fn size_price(&mut self, option_id: i64, size_option_id: i64, price_cents: i64) {
        self.rows.size_prices.push(SizePrice {
            option_id,
            size_option_id,
            price_cents,
        });
    }

    pub fn link(&mut self, item_id: i64, group_id: i64, min: i64, max: i64) {
        let position = self.rows.links.iter().filter(|l| l.item_id == item_id).count() as i64;
        self.rows.links.push(Link {
            item_id,
            group_id,
            min,
            max,
            position,
        });
    }

    pub fn menu(&self, settings: &MenuSettings) -> Menu {
        Assembler::new(&self.rows, settings, NOON).menu(false)
    }
}

pub fn pick(option_id: i64, quantity: i64) -> Choice {
    Choice {
        option_id,
        quantity,
        choices: Vec::new(),
    }
}

pub fn request(item_id: i64, choices: Vec<Choice>) -> QuoteRequest {
    QuoteRequest {
        item_id,
        quantity: 1,
        notes: None,
        choices,
    }
}
