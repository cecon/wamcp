//! Groups of options: a reusable library (min/max live on each item's link). Sending `options`
//! replaces the group's options (entries with an `id` are kept and updated). Items using the group
//! are re-validated in the same transaction, so a change can never break a pizza or combo.
use super::{MenuService, Snapshot};
use crate::domain::actor::Actor;
use crate::domain::error::{fail_with, HelpdeskError, Result};
use crate::domain::helpdesk::require_admin;
use crate::domain::menu::patch::{new_group, new_option, new_product, GroupPatch, OptionPatch};
use crate::domain::menu::pizza::validate_links;
use crate::domain::menu::rules::{self, MAX_OPTIONS, MAX_PRICE_CENTS};
use crate::domain::menu::{Group, GroupView, MenuOption, Product, SizePrice};

/// An option ready to be stored, with its product (reused when `shared`).
struct Prepared {
    option: MenuOption,
    product: Product,
    shared: bool,
    size_prices: Vec<SizePrice>,
}

fn rejected<T>(message: impl Into<String>) -> Result<T> {
    fail_with(message, 422)
}

impl MenuService {
    pub fn groups(&self, _actor: &Actor) -> Result<Vec<GroupView>> {
        Ok(self.snapshot()?.assembler().groups())
    }

    fn prepare(&self, snapshot: &Snapshot, group: &Group, index: usize, patch: &OptionPatch) -> Result<Prepared> {
        let rows = &snapshot.rows;
        let (mut option, mut product) = match patch.id {
            Some(id) => {
                let Some(existing) = rows.options.iter().find(|o| o.id == id && o.group_id == group.id) else {
                    return rejected(format!("A opção {id} não pertence ao grupo"));
                };
                let product = rows.products.iter().find(|p| p.id == existing.product_id).cloned();
                (existing.clone(), product.unwrap_or_else(new_product))
            }
            None => (new_option(), new_product()),
        };
        let shared = patch.product_id.is_some();
        match patch.product_id {
            Some(id) => match rows.products.iter().find(|p| p.id == id) {
                Some(found) => product = found.clone(),
                None => return rejected("Produto não encontrado"),
            },
            None => {
                if let Some(changes) = &patch.product {
                    changes.apply(&mut product);
                }
            }
        }
        option.position = index as i64;
        patch.apply(&mut option);
        let size_prices = match &patch.size_prices {
            Some(prices) => prices.clone(),
            None => rows
                .size_prices
                .iter()
                .filter(|s| s.option_id == option.id)
                .cloned()
                .collect(),
        };
        rules::product(&product)?;
        rules::option(&group.kind, &option, size_prices.len())?;
        for price in &size_prices {
            let is_size = rows.options.iter().any(|o| {
                o.id == price.size_option_id && rows.groups.iter().any(|g| g.id == o.group_id && g.kind == "size")
            });
            if !is_size {
                return rejected(format!("Tamanho {} não encontrado", price.size_option_id));
            }
            if !(0..=MAX_PRICE_CENTS).contains(&price.price_cents) {
                return rejected("Preço por tamanho inválido");
            }
        }
        if let Some(item_id) = option.item_id {
            match rows.items.iter().find(|i| i.id == item_id) {
                None => return rejected("Item do combo não encontrado"),
                Some(item) if item.kind == "combo" => return rejected("Um combo não pode conter outro combo"),
                _ => {}
            }
        }
        Ok(Prepared {
            option,
            product,
            shared,
            size_prices,
        })
    }

    fn store_group(
        &self,
        actor: &Actor,
        snapshot: &Snapshot,
        group: Group,
        options: Option<&[OptionPatch]>,
    ) -> Result<i64> {
        rules::group(&group)?;
        let others = snapshot.rows.groups.iter().filter(|g| g.id != group.id);
        if group.external_code.is_some() && others.clone().any(|g| g.external_code == group.external_code) {
            return fail_with("Código PDV já usado por outro grupo", 409);
        }
        if options.is_some_and(|o| o.len() > MAX_OPTIONS) {
            return rejected("Opções demais no grupo");
        }
        let prepared = match options {
            Some(list) => Some(
                list.iter()
                    .enumerate()
                    .map(|(index, patch)| self.prepare(snapshot, &group, index, patch))
                    .collect::<Result<Vec<_>>>()?,
            ),
            None => None,
        };
        let repo = &self.core.repo;
        self.core.commit(Some(actor), |_| {
            let id = repo.save_group(&group)?;
            if let Some(prepared) = prepared {
                let kept: Vec<i64> = prepared.iter().map(|p| p.option.id).filter(|id| *id != 0).collect();
                let stale = snapshot.rows.options.iter().filter(|o| o.group_id == id);
                for old in stale.filter(|o| !kept.contains(&o.id)) {
                    repo.delete_option(old.id)?;
                }
                for mut entry in prepared {
                    entry.option.group_id = id;
                    entry.option.product_id = if entry.shared {
                        entry.product.id
                    } else {
                        repo.save_product(&entry.product)?
                    };
                    let option_id = repo.save_option(&entry.option)?;
                    repo.set_size_prices(option_id, &entry.size_prices)?;
                }
                repo.prune_products()?;
            }
            self.revalidate(id)?;
            Ok(id)
        })
    }

    /// Every item linking the group must still satisfy its structure rules.
    fn revalidate(&self, group_id: i64) -> Result<()> {
        let snapshot = self.snapshot()?;
        let assembler = snapshot.assembler();
        for link in snapshot.rows.links.iter().filter(|l| l.group_id == group_id) {
            if let Some(item) = assembler.item(link.item_id) {
                let views: Vec<_> = item.groups.into_iter().map(|l| (l.link, l.group)).collect();
                validate_links(&item.item.kind, &views).map_err(|error| match error {
                    crate::domain::error::Error::Helpdesk(e) => HelpdeskError::with_status(
                        format!("‘{}’ ficaria inválido: {}", item.product.name, e.message),
                        422,
                    )
                    .into(),
                    other => other,
                })?;
            }
        }
        Ok(())
    }

    pub fn create_group(&self, actor: &Actor, patch: &GroupPatch) -> Result<GroupView> {
        require_admin(actor)?;
        let snapshot = self.snapshot()?;
        let mut group = new_group();
        patch.apply(&mut group);
        let options = patch.options.as_deref().unwrap_or_default();
        let id = self.store_group(actor, &snapshot, group, Some(options))?;
        self.changed(actor, "group", "created", Some(id));
        self.group(actor, id)
    }

    pub fn update_group(&self, actor: &Actor, id: i64, patch: &GroupPatch) -> Result<GroupView> {
        require_admin(actor)?;
        let snapshot = self.snapshot()?;
        let mut group = snapshot
            .rows
            .groups
            .iter()
            .find(|g| g.id == id)
            .cloned()
            .ok_or_else(|| HelpdeskError::not_found("Grupo não encontrado"))?;
        patch.apply(&mut group);
        self.store_group(actor, &snapshot, group, patch.options.as_deref())?;
        self.changed(actor, "group", "updated", Some(id));
        self.group(actor, id)
    }

    pub fn delete_group(&self, actor: &Actor, id: i64) -> Result<()> {
        require_admin(actor)?;
        let group = self.group(actor, id)?;
        if group.used_by > 0 {
            return fail_with("O grupo está em uso por itens do cardápio", 409);
        }
        self.core.commit(Some(actor), |_| {
            self.core.repo.delete_group(id)?;
            self.core.repo.prune_products()
        })?;
        self.changed(actor, "group", "deleted", Some(id));
        Ok(())
    }
}
