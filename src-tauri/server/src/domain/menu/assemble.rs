//! Builds the API views (items with product, groups and options expanded) from the stored rows.
use super::availability::available_now;
use super::model::{
    Category, CategoryView, GroupView, ItemView, LinkView, Menu, MenuRows, MenuSettings, OptionView, Product,
};
use std::collections::HashMap;

/// Lookup tables over the rows, shared by every view of one snapshot.
pub struct Assembler<'a> {
    rows: &'a MenuRows,
    products: HashMap<i64, &'a Product>,
    categories: HashMap<i64, &'a Category>,
    settings: &'a MenuSettings,
    now: i64,
}

impl<'a> Assembler<'a> {
    pub fn new(rows: &'a MenuRows, settings: &'a MenuSettings, now: i64) -> Self {
        Self {
            rows,
            products: rows.products.iter().map(|p| (p.id, p)).collect(),
            categories: rows.categories.iter().map(|c| (c.id, c)).collect(),
            settings,
            now,
        }
    }

    fn product(&self, id: i64) -> Product {
        self.products.get(&id).map(|p| (*p).clone()).unwrap_or_default()
    }

    /// A group with its options (by position) and how many items use it.
    pub fn group(&self, id: i64) -> Option<GroupView> {
        let group = self.rows.groups.iter().find(|g| g.id == id)?.clone();
        let mut options: Vec<OptionView> = self
            .rows
            .options
            .iter()
            .filter(|o| o.group_id == id)
            .map(|o| OptionView {
                option: o.clone(),
                product: self.product(o.product_id),
                size_prices: self
                    .rows
                    .size_prices
                    .iter()
                    .filter(|s| s.option_id == o.id)
                    .cloned()
                    .collect(),
            })
            .collect();
        options.sort_by_key(|o| (o.option.position, o.option.id));
        let used_by = self.rows.links.iter().filter(|l| l.group_id == id).count() as i64;
        Some(GroupView {
            group,
            options,
            used_by,
        })
    }

    pub fn groups(&self) -> Vec<GroupView> {
        let mut groups: Vec<GroupView> = self.rows.groups.iter().filter_map(|g| self.group(g.id)).collect();
        groups.sort_by_key(|g| g.group.name.to_lowercase());
        groups
    }

    pub fn item(&self, id: i64) -> Option<ItemView> {
        let item = self.rows.items.iter().find(|i| i.id == id)?.clone();
        let mut links: Vec<_> = self.rows.links.iter().filter(|l| l.item_id == id).collect();
        links.sort_by_key(|l| (l.position, l.group_id));
        let groups = links
            .into_iter()
            .filter_map(|l| self.group(l.group_id).map(|group| LinkView { link: l.clone(), group }))
            .collect();
        let category_status = self
            .categories
            .get(&item.category_id)
            .map_or("unavailable", |c| c.status.as_str());
        let available = available_now(
            &item.status,
            category_status,
            &item.shifts,
            self.now,
            &self.settings.timezone,
        );
        Some(ItemView {
            product: self.product(item.product_id),
            item,
            groups,
            available_now: available,
        })
    }

    /// Categories (by position) with their item counts.
    pub fn categories(&self) -> Vec<Category> {
        let mut categories: Vec<Category> = self
            .rows
            .categories
            .iter()
            .map(|c| Category {
                items_count: self.rows.items.iter().filter(|i| i.category_id == c.id).count() as i64,
                ..c.clone()
            })
            .collect();
        categories.sort_by_key(|c| (c.position, c.id));
        categories
    }

    /// Items of a category, by position.
    pub fn category_items(&self, category_id: i64) -> Vec<ItemView> {
        let mut items: Vec<_> = self
            .rows
            .items
            .iter()
            .filter(|i| i.category_id == category_id)
            .collect();
        items.sort_by_key(|i| (i.position, i.id));
        items.into_iter().filter_map(|i| self.item(i.id)).collect()
    }

    /// The whole menu; `only_available` keeps what can be ordered now (and drops empty categories).
    pub fn menu(&self, only_available: bool) -> Menu {
        let categories = self
            .categories()
            .into_iter()
            .map(|category| {
                let mut items = self.category_items(category.id);
                if only_available {
                    items.retain(|i| i.available_now);
                }
                CategoryView { category, items }
            })
            .filter(|c| !only_available || !c.items.is_empty())
            .collect();
        Menu {
            settings: self.settings.clone(),
            categories,
        }
    }
}
