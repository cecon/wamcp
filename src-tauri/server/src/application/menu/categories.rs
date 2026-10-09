//! Categories: unique names, at most one pizza category, deletion only when empty, reordering.
use super::{MenuService, Snapshot};
use crate::domain::actor::Actor;
use crate::domain::error::{fail, fail_with, Result};
use crate::domain::helpdesk::require_admin;
use crate::domain::menu::patch::{new_category, CategoryPatch};
use crate::domain::menu::rules::{self, fold};
use crate::domain::menu::Category;

/// Same unordered set of ids (reorder requests must list every entry once).
pub(super) fn same_ids(given: &[i64], existing: &[i64]) -> bool {
    let (mut a, mut b) = (given.to_vec(), existing.to_vec());
    a.sort_unstable();
    b.sort_unstable();
    a.dedup();
    a.len() == given.len() && a == b
}

impl MenuService {
    pub fn categories(&self, _actor: &Actor) -> Result<Vec<Category>> {
        Ok(self.snapshot()?.assembler().categories())
    }

    fn check_category(&self, snapshot: &Snapshot, category: &Category) -> Result<()> {
        rules::category(category)?;
        let others = snapshot.rows.categories.iter().filter(|c| c.id != category.id);
        for other in others {
            if fold(&other.name) == fold(&category.name) {
                return fail_with("Já existe uma categoria com esse nome", 409);
            }
            if category.template == "pizza" && other.template == "pizza" {
                return fail_with("Já existe uma categoria de pizza", 422);
            }
            if category.external_code.is_some() && other.external_code == category.external_code {
                return fail_with("Código PDV já usado por outra categoria", 409);
            }
        }
        Ok(())
    }

    fn category_view(&self, id: i64) -> Result<Category> {
        let snapshot = self.snapshot()?;
        let assembler = snapshot.assembler();
        let found = assembler.categories().into_iter().find(|c| c.id == id);
        found.map_or_else(|| self.category_row(&snapshot, id), Ok)
    }

    pub fn create_category(&self, actor: &Actor, patch: &CategoryPatch) -> Result<Category> {
        require_admin(actor)?;
        let snapshot = self.snapshot()?;
        let mut category = new_category();
        category.position = snapshot
            .rows
            .categories
            .iter()
            .map(|c| c.position + 1)
            .max()
            .unwrap_or(0);
        patch.apply(&mut category);
        self.check_category(&snapshot, &category)?;
        let id = self.core.repo.save_category(&category)?;
        self.changed(actor, "category", "created", Some(id));
        self.category_view(id)
    }

    pub fn update_category(&self, actor: &Actor, id: i64, patch: &CategoryPatch) -> Result<Category> {
        require_admin(actor)?;
        let snapshot = self.snapshot()?;
        let mut category = self.category_row(&snapshot, id)?;
        let template = category.template.clone();
        patch.apply(&mut category);
        self.check_category(&snapshot, &category)?;
        if category.template != template && snapshot.rows.items.iter().any(|i| i.category_id == id) {
            return fail_with("Esvazie a categoria antes de trocar o modelo", 422);
        }
        self.core.repo.save_category(&category)?;
        self.changed(actor, "category", "updated", Some(id));
        self.category_view(id)
    }

    pub fn delete_category(&self, actor: &Actor, id: i64) -> Result<()> {
        require_admin(actor)?;
        let snapshot = self.snapshot()?;
        self.category_row(&snapshot, id)?;
        if snapshot.rows.items.iter().any(|i| i.category_id == id) {
            return fail_with("A categoria precisa estar vazia para ser apagada", 409);
        }
        self.core.repo.delete_category(id)?;
        self.changed(actor, "category", "deleted", Some(id));
        Ok(())
    }

    pub fn reorder_categories(&self, actor: &Actor, ids: &[i64]) -> Result<Vec<Category>> {
        require_admin(actor)?;
        let snapshot = self.snapshot()?;
        let existing: Vec<i64> = snapshot.rows.categories.iter().map(|c| c.id).collect();
        if !same_ids(ids, &existing) {
            return fail("Envie todas as categorias, cada uma uma vez");
        }
        self.core
            .commit(Some(actor), |_| self.core.repo.set_positions("categories", ids))?;
        self.changed(actor, "category", "reordered", None);
        self.categories(actor)
    }
}
