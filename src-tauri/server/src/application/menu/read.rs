//! Settings, search and the order quote (shared by the API and the inbox assistant).
use super::MenuService;
use crate::domain::actor::Actor;
use crate::domain::error::Result;
use crate::domain::helpdesk::require_admin;
use crate::domain::menu::patch::SettingsPatch;
use crate::domain::menu::{quote, rules, search, ItemView, MenuSettings, Quote, QuoteRequest};

impl MenuService {
    pub fn settings(&self, _actor: &Actor) -> Result<MenuSettings> {
        self.core.repo.menu_settings()
    }

    pub fn update_settings(&self, actor: &Actor, patch: &SettingsPatch) -> Result<MenuSettings> {
        require_admin(actor)?;
        let mut settings = self.core.repo.menu_settings()?;
        patch.apply(&mut settings);
        rules::settings(&settings)?;
        self.core.repo.save_menu_settings(&settings)?;
        self.changed(actor, "settings", "updated", None);
        Ok(settings)
    }

    /// Up to 20 items matching name, description or PDV code.
    pub fn search(&self, _actor: &Actor, query: &str, only_available: bool) -> Result<Vec<ItemView>> {
        let menu = self.menu(false)?;
        Ok(search::search(&menu, query, only_available)
            .into_iter()
            .cloned()
            .collect())
    }

    pub fn quote(&self, _actor: &Actor, request: &QuoteRequest) -> Result<Quote> {
        quote::quote(&self.menu(false)?, request)
    }
}
