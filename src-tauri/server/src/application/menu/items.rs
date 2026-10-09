//! Items: the offer of a product in a category (price, availability, shifts and linked groups).
//! The item's type follows its category's template; pizza and combo structures are validated.
use super::categories::same_ids;
use super::{MenuService, Snapshot};
use crate::domain::actor::Actor;
use crate::domain::error::{fail, fail_with, HelpdeskError, Result};
use crate::domain::helpdesk::require_admin;
use crate::domain::menu::patch::{new_item, new_product, ItemPatch};
use crate::domain::menu::pizza::validate_links;
use crate::domain::menu::search::filter;
use crate::domain::menu::{rules, GroupView, Item, ItemView, Link, Product, STATUSES};

const KIND_MISMATCH: &str = "O tipo do item deve ser igual ao modelo da categoria";

impl MenuService {
    pub fn items(
        &self,
        _actor: &Actor,
        category_id: Option<i64>,
        query: Option<&str>,
        status: Option<&str>,
    ) -> Result<Vec<ItemView>> {
        let menu = self.menu(false)?;
        Ok(filter(&menu, category_id, query, status).into_iter().cloned().collect())
    }

    fn item_row(snapshot: &Snapshot, id: i64) -> Result<(Item, Product)> {
        let item = snapshot.rows.items.iter().find(|i| i.id == id).cloned();
        let item = item.ok_or_else(|| HelpdeskError::not_found("Item não encontrado"))?;
        let product = snapshot.rows.products.iter().find(|p| p.id == item.product_id).cloned();
        Ok((item, product.unwrap_or_else(new_product)))
    }

    /// Validates the item, its product and its links, then stores them atomically.
    fn store_item(
        &self,
        actor: &Actor,
        snapshot: &Snapshot,
        mut item: Item,
        mut product: Product,
        links: Vec<Link>,
    ) -> Result<i64> {
        rules::product(&product)?;
        rules::item(&item)?;
        let category = self.category_row(snapshot, item.category_id)?;
        if category.template != item.kind {
            return fail_with("O item precisa ficar numa categoria do mesmo modelo", 422);
        }
        let others = snapshot.rows.items.iter().filter(|i| i.id != item.id);
        if item.external_code.is_some() && others.clone().any(|i| i.external_code == item.external_code) {
            return fail_with("Código PDV já usado por outro item", 409);
        }
        let assembler = snapshot.assembler();
        let mut views: Vec<(Link, GroupView)> = Vec::new();
        for (position, mut link) in links.into_iter().enumerate() {
            let group = assembler
                .group(link.group_id)
                .ok_or_else(|| HelpdeskError::with_status("Grupo de complementos não encontrado", 422))?;
            link.position = position as i64;
            views.push((link, group));
        }
        validate_links(&item.kind, &views)?;
        self.core.commit(Some(actor), |_| {
            item.product_id = self.core.repo.save_product(&product)?;
            product.id = item.product_id;
            let id = self.core.repo.save_item(&item)?;
            let links: Vec<Link> = views.iter().map(|(l, _)| l.clone()).collect();
            self.core.repo.set_item_links(id, &links)?;
            Ok(id)
        })
    }

    pub fn create_item(&self, actor: &Actor, patch: &ItemPatch) -> Result<ItemView> {
        require_admin(actor)?;
        let snapshot = self.snapshot()?;
        let Some(category_id) = patch.category_id else {
            return fail("Informe a categoria do item");
        };
        let category = self.category_row(&snapshot, category_id)?;
        let mut item = new_item();
        item.kind = category.template.clone();
        if patch.kind.as_ref().is_some_and(|k| *k != item.kind) {
            return fail_with(KIND_MISMATCH, 422);
        }
        item.position = snapshot
            .rows
            .items
            .iter()
            .filter(|i| i.category_id == category_id)
            .map(|i| i.position + 1)
            .max()
            .unwrap_or(0);
        patch.apply(&mut item);
        let mut product = new_product();
        if let Some(changes) = &patch.product {
            changes.apply(&mut product);
        }
        let links = patch.groups.clone().unwrap_or_default();
        let id = self.store_item(actor, &snapshot, item, product, links)?;
        self.changed(actor, "item", "created", Some(id));
        self.item(actor, id)
    }

    pub fn update_item(&self, actor: &Actor, id: i64, patch: &ItemPatch) -> Result<ItemView> {
        require_admin(actor)?;
        let snapshot = self.snapshot()?;
        let (mut item, mut product) = Self::item_row(&snapshot, id)?;
        if patch.kind.as_ref().is_some_and(|k| *k != item.kind) {
            return fail_with(KIND_MISMATCH, 422);
        }
        patch.apply(&mut item);
        if let Some(changes) = &patch.product {
            changes.apply(&mut product);
        }
        let links = match &patch.groups {
            Some(links) => links.clone(),
            None => {
                let mut links: Vec<Link> = snapshot
                    .rows
                    .links
                    .iter()
                    .filter(|l| l.item_id == id)
                    .cloned()
                    .collect();
                links.sort_by_key(|l| l.position);
                links
            }
        };
        self.store_item(actor, &snapshot, item, product, links)?;
        self.changed(actor, "item", "updated", Some(id));
        self.item(actor, id)
    }

    pub fn delete_item(&self, actor: &Actor, id: i64) -> Result<()> {
        require_admin(actor)?;
        let snapshot = self.snapshot()?;
        Self::item_row(&snapshot, id)?;
        self.core.commit(Some(actor), |_| {
            self.core.repo.delete_item(id)?;
            self.core.repo.prune_products()
        })?;
        self.changed(actor, "item", "deleted", Some(id));
        Ok(())
    }

    /// A copy at the end of the same category, named "… (cópia)", without iFood id or PDV code.
    pub fn duplicate_item(&self, actor: &Actor, id: i64) -> Result<ItemView> {
        require_admin(actor)?;
        let snapshot = self.snapshot()?;
        let (mut item, mut product) = Self::item_row(&snapshot, id)?;
        let links: Vec<Link> = snapshot
            .rows
            .links
            .iter()
            .filter(|l| l.item_id == id)
            .cloned()
            .collect();
        let base: String = product.name.chars().take(111).collect();
        product.name = format!("{} (cópia)", base.trim_end());
        product.id = 0;
        product.ifood_id = None;
        item.id = 0;
        item.ifood_id = None;
        item.external_code = None;
        item.position = snapshot
            .rows
            .items
            .iter()
            .filter(|i| i.category_id == item.category_id)
            .map(|i| i.position + 1)
            .max()
            .unwrap_or(0);
        let copy = self.store_item(actor, &snapshot, item, product, links)?;
        self.changed(actor, "item", "created", Some(copy));
        self.item(actor, copy)
    }

    pub fn reorder_items(&self, actor: &Actor, category_id: i64, ids: &[i64]) -> Result<Vec<ItemView>> {
        require_admin(actor)?;
        let snapshot = self.snapshot()?;
        self.category_row(&snapshot, category_id)?;
        let existing: Vec<i64> = snapshot
            .rows
            .items
            .iter()
            .filter(|i| i.category_id == category_id)
            .map(|i| i.id)
            .collect();
        if !same_ids(ids, &existing) {
            return fail("Envie todos os itens da categoria, cada um uma vez");
        }
        self.core
            .commit(Some(actor), |_| self.core.repo.set_positions("items", ids))?;
        self.changed(actor, "item", "reordered", None);
        self.items(actor, Some(category_id), None, None)
    }

    /// Pauses or resumes several items at once.
    pub fn set_items_status(&self, actor: &Actor, ids: &[i64], status: &str) -> Result<Vec<ItemView>> {
        require_admin(actor)?;
        if !STATUSES.contains(&status) {
            return fail("Situação inválida (use available ou unavailable)");
        }
        let snapshot = self.snapshot()?;
        if ids.is_empty() || ids.iter().any(|id| !snapshot.rows.items.iter().any(|i| i.id == *id)) {
            return Err(HelpdeskError::not_found("Item não encontrado").into());
        }
        self.core
            .commit(Some(actor), |_| self.core.repo.set_items_status(ids, status))?;
        self.changed(actor, "item", "status", None);
        let menu = self.menu(false)?;
        Ok(menu.items().filter(|i| ids.contains(&i.item.id)).cloned().collect())
    }
}
