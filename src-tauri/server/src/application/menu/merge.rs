//! Writes an import tree into the catalog. Existing entries are matched by `ifood_id`, then by
//! `external_code` (categories also by name, and the single pizza category by template); matches are
//! updated, the rest created, and local-only entries are kept. Groups shared by several items are
//! written once; sizes are written before toppings so per-size prices can point at them.
use crate::application::ports::Repository;
use crate::domain::error::Result;
use crate::domain::menu::import::{group_key, ImportCategory, ImportGroup, ImportItem, ImportTree};
use crate::domain::menu::patch::{new_category, new_group, new_item, new_option, new_product};
use crate::domain::menu::rules::fold;
use crate::domain::menu::{Category, Link, MenuRows, Product, SizePrice};
use std::collections::HashMap;

/// An entry matches by iFood id first, then by PDV code.
fn matches(
    ifood: &Option<String>,
    code: &Option<String>,
    other_ifood: &Option<String>,
    other_code: &Option<String>,
) -> bool {
    (ifood.is_some() && ifood == other_ifood) || (code.is_some() && code == other_code)
}

pub struct Writer<'a> {
    pub repo: &'a dyn Repository,
    pub rows: MenuRows,
    /// Downloaded photos: source URL → stored file name.
    pub files: &'a HashMap<String, String>,
    groups: HashMap<String, i64>,
    sizes: HashMap<String, i64>,
}

impl<'a> Writer<'a> {
    pub fn new(repo: &'a dyn Repository, rows: MenuRows, files: &'a HashMap<String, String>) -> Self {
        Self {
            repo,
            rows,
            files,
            groups: HashMap::new(),
            sizes: HashMap::new(),
        }
    }

    fn image(&self, source: &Option<String>, current: Option<String>) -> Option<String> {
        source.as_ref().and_then(|s| self.files.get(s).cloned()).or(current)
    }

    fn product(&self, id: Option<i64>) -> Product {
        id.and_then(|id| self.rows.products.iter().find(|p| p.id == id).cloned())
            .unwrap_or_else(new_product)
    }

    pub fn write(&mut self, tree: &ImportTree) -> Result<()> {
        let mut next = self.rows.categories.iter().map(|c| c.position + 1).max().unwrap_or(0);
        for imported in &tree.categories {
            let id = self.category(imported, &mut next)?;
            let template = self
                .rows
                .categories
                .iter()
                .find(|c| c.id == id)
                .map_or_else(|| imported.template.clone(), |c| c.template.clone());
            for (position, item) in imported.items.iter().enumerate() {
                self.item(item, id, &template, position as i64)?;
            }
        }
        Ok(())
    }

    fn category(&mut self, imported: &ImportCategory, next: &mut i64) -> Result<i64> {
        let rows = &self.rows.categories;
        let found = rows
            .iter()
            .find(|c| {
                matches(
                    &imported.ifood_id,
                    &imported.external_code,
                    &c.ifood_id,
                    &c.external_code,
                )
            })
            .or_else(|| rows.iter().find(|c| fold(&c.name) == fold(&imported.name)))
            .or_else(|| {
                rows.iter()
                    .find(|c| imported.template == "pizza" && c.template == "pizza")
            });
        let mut category = found.cloned().unwrap_or_else(|| {
            *next += 1;
            Category {
                position: *next - 1,
                ..new_category()
            }
        });
        let current = category.id;
        let others: Vec<&Category> = rows.iter().filter(|c| c.id != current).collect();
        if !others.iter().any(|c| fold(&c.name) == fold(&imported.name)) {
            category.name = imported.name.clone();
        }
        let pizza_elsewhere = others.iter().any(|c| c.template == "pizza");
        category.template = if imported.template == "pizza" && pizza_elsewhere {
            "default".into()
        } else {
            imported.template.clone()
        };
        category.description = imported.description.clone();
        category.external_code = imported.external_code.clone();
        category.ifood_id = imported.ifood_id.clone();
        category.status = imported.status.clone();
        category.id = self.repo.save_category(&category)?;
        self.rows.categories.retain(|c| c.id != category.id);
        self.rows.categories.push(category.clone());
        Ok(category.id)
    }

    fn item(&mut self, imported: &ImportItem, category_id: i64, kind: &str, position: i64) -> Result<()> {
        let found = self
            .rows
            .items
            .iter()
            .find(|i| {
                matches(
                    &imported.ifood_id,
                    &imported.external_code,
                    &i.ifood_id,
                    &i.external_code,
                )
            })
            .cloned();
        let mut product = self.product(found.as_ref().map(|i| i.product_id));
        product.name = imported.name.clone();
        product.description = imported.description.clone();
        product.external_code = imported.product_code.clone();
        product.ean = imported.ean.clone();
        product.serving = imported.serving.clone();
        product.dietary = imported.dietary.clone();
        product.ifood_id = imported.ifood_id.clone();
        product.image = self.image(&imported.image_url, product.image.clone());
        let mut item = found.unwrap_or_else(new_item);
        item.product_id = self.repo.save_product(&product)?;
        item.category_id = category_id;
        item.kind = kind.into();
        item.price_cents = if kind == "pizza" { 0 } else { imported.price_cents };
        item.original_price_cents = imported.original_price_cents.filter(|o| *o > item.price_cents);
        item.status = imported.status.clone();
        item.external_code = imported.external_code.clone();
        item.shifts = imported.shifts.clone();
        item.position = position;
        item.ifood_id = imported.ifood_id.clone();
        item.id = self.repo.save_item(&item)?;
        let mut ordered: Vec<&ImportGroup> = imported.groups.iter().filter(|g| g.kind == "size").collect();
        ordered.extend(imported.groups.iter().filter(|g| g.kind != "size"));
        let mut links = Vec::new();
        for group in ordered {
            let group_id = self.group(group)?;
            let position = imported.groups.iter().position(|g| std::ptr::eq(g, group)).unwrap_or(0);
            links.push(Link {
                item_id: item.id,
                group_id,
                min: group.min,
                max: group.max,
                position: position as i64,
            });
        }
        links.sort_by_key(|l| l.position);
        self.repo.set_item_links(item.id, &links)?;
        self.rows.items.retain(|i| i.id != item.id);
        self.rows.items.push(item);
        Ok(())
    }

    fn group(&mut self, imported: &ImportGroup) -> Result<i64> {
        let key = group_key(imported);
        if let Some(id) = self.groups.get(&key) {
            return Ok(*id);
        }
        let found = self
            .rows
            .groups
            .iter()
            .find(|g| {
                matches(
                    &imported.ifood_id,
                    &imported.external_code,
                    &g.ifood_id,
                    &g.external_code,
                )
            })
            .cloned();
        let mut group = found.unwrap_or_else(new_group);
        group.name = imported.name.clone();
        group.kind = imported.kind.clone();
        group.external_code = imported.external_code.clone();
        group.ifood_id = imported.ifood_id.clone();
        group.status = imported.status.clone();
        group.id = self.repo.save_group(&group)?;
        let existing: Vec<_> = self
            .rows
            .options
            .iter()
            .filter(|o| o.group_id == group.id)
            .cloned()
            .collect();
        let mut kept = Vec::new();
        for (position, imported_option) in imported.options.iter().enumerate() {
            let found = existing.iter().find(|o| {
                !kept.contains(&o.id)
                    && matches(
                        &imported_option.ifood_id,
                        &imported_option.external_code,
                        &o.ifood_id,
                        &o.external_code,
                    )
            });
            let mut product = self.product(found.map(|o| o.product_id));
            product.name = imported_option.name.clone();
            product.description = imported_option.description.clone();
            product.external_code = imported_option.external_code.clone();
            product.ifood_id = imported_option.ifood_id.clone();
            product.image = self.image(&imported_option.image_url, product.image.clone());
            let mut option = found.cloned().unwrap_or_else(new_option);
            option.group_id = group.id;
            option.product_id = self.repo.save_product(&product)?;
            option.price_cents = imported_option.price_cents;
            option.original_price_cents = imported_option.original_price_cents;
            option.status = imported_option.status.clone();
            option.external_code = imported_option.external_code.clone();
            option.max_quantity = imported_option.max_quantity;
            option.fractions = imported_option.fractions.clone();
            option.position = position as i64;
            option.ifood_id = imported_option.ifood_id.clone();
            option.id = self.repo.save_option(&option)?;
            kept.push(option.id);
            if group.kind == "size" {
                self.sizes.insert(imported_option.key(), option.id);
            }
            let prices: Vec<SizePrice> = imported_option
                .size_prices
                .iter()
                .filter_map(|p| {
                    self.sizes.get(&p.size).map(|size| SizePrice {
                        option_id: option.id,
                        size_option_id: *size,
                        price_cents: p.price_cents,
                    })
                })
                .collect();
            self.repo.set_size_prices(option.id, &prices)?;
        }
        for stale in existing.iter().filter(|o| !kept.contains(&o.id)) {
            self.repo.delete_option(stale.id)?;
        }
        self.groups.insert(key, group.id);
        self.rows.groups.retain(|g| g.id != group.id);
        self.rows.groups.push(group.clone());
        Ok(group.id)
    }
}
