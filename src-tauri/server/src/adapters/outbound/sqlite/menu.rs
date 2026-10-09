//! Product catalog (menu) tables: the whole catalog is read at once (it is small) and rows are
//! saved one by one; imports keep their preview and captured payload as JSON.
use super::db::{int, opt_int, opt_text, text, Shape, SqliteStore, PLAIN};
use crate::application::ports::MenuRepo;
use crate::domain::error::{Error, Result};
use crate::domain::menu::{Category, Group, Item, Link, MenuOption, MenuRows, MenuSettings, Product, SizePrice};
use rusqlite::types::Value as Sql;

const PRODUCTS: Shape = Shape {
    json: &["dietary"],
    bools: &[],
};
const ITEMS: Shape = Shape {
    json: &["shifts"],
    bools: &[],
};
const OPTIONS: Shape = Shape {
    json: &["fractions"],
    bools: &[],
};

pub(super) fn json(value: &impl serde::Serialize) -> Result<Sql> {
    Ok(text(serde_json::to_string(value)?))
}

impl SqliteStore {
    /// INSERT when `id` is 0, else UPDATE; returns the row id.
    fn save_row(&self, table: &str, id: i64, columns: &[&str], mut values: Vec<Sql>) -> Result<i64> {
        if id == 0 {
            let marks = vec!["?"; columns.len()].join(",");
            return self.insert(
                &format!("INSERT INTO {table}({}) VALUES({marks})", columns.join(",")),
                values,
            );
        }
        let sets: Vec<String> = columns.iter().map(|c| format!("{c}=?")).collect();
        values.push(int(id));
        self.exec(&format!("UPDATE {table} SET {} WHERE id=?", sets.join(",")), values)?;
        Ok(id)
    }
}

impl MenuRepo for SqliteStore {
    fn menu_rows(&self) -> Result<MenuRows> {
        Ok(MenuRows {
            categories: self.rows("SELECT * FROM menu_categories", vec![], PLAIN)?,
            products: self.rows("SELECT * FROM menu_products", vec![], PRODUCTS)?,
            items: self.rows("SELECT *, kind AS type FROM menu_items", vec![], ITEMS)?,
            links: self.rows("SELECT * FROM menu_item_groups", vec![], PLAIN)?,
            groups: self.rows("SELECT *, kind AS type FROM menu_groups", vec![], PLAIN)?,
            options: self.rows("SELECT * FROM menu_options", vec![], OPTIONS)?,
            size_prices: self.rows("SELECT * FROM menu_size_prices", vec![], PLAIN)?,
        })
    }

    fn menu_settings(&self) -> Result<MenuSettings> {
        Ok(self
            .row("SELECT * FROM menu_settings WHERE id=1", vec![], PLAIN)?
            .unwrap_or_default())
    }

    fn save_menu_settings(&self, s: &MenuSettings) -> Result<()> {
        self.exec(
            "UPDATE menu_settings SET pizza_pricing=?,notes_max_length=?,timezone=? WHERE id=1",
            vec![text(&s.pizza_pricing), int(s.notes_max_length), text(&s.timezone)],
        )
        .map(drop)
    }

    fn save_category(&self, c: &Category) -> Result<i64> {
        let columns = [
            "name",
            "description",
            "template",
            "external_code",
            "status",
            "position",
            "ifood_id",
        ];
        let values = vec![
            text(&c.name),
            opt_text(c.description.as_deref()),
            text(&c.template),
            opt_text(c.external_code.as_deref()),
            text(&c.status),
            int(c.position),
            opt_text(c.ifood_id.as_deref()),
        ];
        self.save_row("menu_categories", c.id, &columns, values)
    }

    fn delete_category(&self, id: i64) -> Result<()> {
        self.exec("DELETE FROM menu_categories WHERE id=?", vec![int(id)])
            .map(drop)
    }

    fn save_product(&self, p: &Product) -> Result<i64> {
        let columns = [
            "name",
            "description",
            "external_code",
            "ean",
            "serving",
            "dietary",
            "image",
            "slices",
            "ifood_id",
        ];
        let values = vec![
            text(&p.name),
            opt_text(p.description.as_deref()),
            opt_text(p.external_code.as_deref()),
            opt_text(p.ean.as_deref()),
            text(&p.serving),
            json(&p.dietary)?,
            opt_text(p.image.as_deref()),
            opt_int(p.slices),
            opt_text(p.ifood_id.as_deref()),
        ];
        self.save_row("menu_products", p.id, &columns, values)
    }

    fn save_item(&self, i: &Item) -> Result<i64> {
        let columns = [
            "category_id",
            "kind",
            "product_id",
            "price_cents",
            "original_price_cents",
            "status",
            "external_code",
            "shifts",
            "position",
            "ifood_id",
        ];
        let values = vec![
            int(i.category_id),
            text(&i.kind),
            int(i.product_id),
            int(i.price_cents),
            opt_int(i.original_price_cents),
            text(&i.status),
            opt_text(i.external_code.as_deref()),
            json(&i.shifts)?,
            int(i.position),
            opt_text(i.ifood_id.as_deref()),
        ];
        self.save_row("menu_items", i.id, &columns, values)
    }

    fn delete_item(&self, id: i64) -> Result<()> {
        self.exec("DELETE FROM menu_items WHERE id=?", vec![int(id)]).map(drop)
    }

    fn set_item_links(&self, item_id: i64, links: &[Link]) -> Result<()> {
        self.exec("DELETE FROM menu_item_groups WHERE item_id=?", vec![int(item_id)])?;
        for link in links {
            self.exec(
                "INSERT INTO menu_item_groups(item_id,group_id,min,max,position) VALUES(?,?,?,?,?)",
                vec![
                    int(item_id),
                    int(link.group_id),
                    int(link.min),
                    int(link.max),
                    int(link.position),
                ],
            )?;
        }
        Ok(())
    }

    fn save_group(&self, g: &Group) -> Result<i64> {
        let columns = ["name", "kind", "external_code", "status", "ifood_id"];
        let values = vec![
            text(&g.name),
            text(&g.kind),
            opt_text(g.external_code.as_deref()),
            text(&g.status),
            opt_text(g.ifood_id.as_deref()),
        ];
        self.save_row("menu_groups", g.id, &columns, values)
    }

    fn delete_group(&self, id: i64) -> Result<()> {
        self.exec("DELETE FROM menu_groups WHERE id=?", vec![int(id)]).map(drop)
    }

    fn save_option(&self, o: &MenuOption) -> Result<i64> {
        let columns = [
            "group_id",
            "product_id",
            "price_cents",
            "original_price_cents",
            "status",
            "external_code",
            "max_quantity",
            "fractions",
            "item_id",
            "position",
            "ifood_id",
        ];
        let fractions = match &o.fractions {
            Some(f) => json(f)?,
            None => Sql::Null,
        };
        let values = vec![
            int(o.group_id),
            int(o.product_id),
            int(o.price_cents),
            opt_int(o.original_price_cents),
            text(&o.status),
            opt_text(o.external_code.as_deref()),
            int(o.max_quantity),
            fractions,
            opt_int(o.item_id),
            int(o.position),
            opt_text(o.ifood_id.as_deref()),
        ];
        self.save_row("menu_options", o.id, &columns, values)
    }

    fn delete_option(&self, id: i64) -> Result<()> {
        self.exec("DELETE FROM menu_options WHERE id=?", vec![int(id)])
            .map(drop)
    }

    fn set_size_prices(&self, option_id: i64, prices: &[SizePrice]) -> Result<()> {
        self.exec("DELETE FROM menu_size_prices WHERE option_id=?", vec![int(option_id)])?;
        for price in prices {
            self.exec(
                "INSERT OR REPLACE INTO menu_size_prices(option_id,size_option_id,price_cents) VALUES(?,?,?)",
                vec![int(option_id), int(price.size_option_id), int(price.price_cents)],
            )?;
        }
        Ok(())
    }

    fn set_positions(&self, table: &str, ids: &[i64]) -> Result<()> {
        let table = match table {
            "categories" => "menu_categories",
            "items" => "menu_items",
            other => return Err(Error::internal(format!("unknown menu table {other}"))),
        };
        for (position, id) in ids.iter().enumerate() {
            self.exec(
                &format!("UPDATE {table} SET position=? WHERE id=?"),
                vec![int(position as i64), int(*id)],
            )?;
        }
        Ok(())
    }

    fn set_items_status(&self, ids: &[i64], status: &str) -> Result<usize> {
        let mut changed = 0;
        for id in ids {
            changed += self.exec(
                "UPDATE menu_items SET status=? WHERE id=?",
                vec![text(status), int(*id)],
            )?;
        }
        Ok(changed)
    }

    fn prune_products(&self) -> Result<()> {
        self.exec(
            "DELETE FROM menu_products WHERE id NOT IN (SELECT product_id FROM menu_items)
               AND id NOT IN (SELECT product_id FROM menu_options)",
            vec![],
        )
        .map(drop)
    }

    fn wipe_menu(&self) -> Result<()> {
        for table in [
            "menu_size_prices",
            "menu_item_groups",
            "menu_options",
            "menu_items",
            "menu_groups",
            "menu_categories",
            "menu_products",
        ] {
            self.exec(&format!("DELETE FROM {table}"), vec![])?;
        }
        Ok(())
    }
}
