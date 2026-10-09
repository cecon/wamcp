//! Account settings (name, language) and automatic resolution of inactive conversations.
use super::helpdesk::HelpdeskService;
use crate::domain::actor::Actor;
use crate::domain::error::Result;
use crate::domain::helpdesk::require_admin;
use crate::domain::model::Account;
use serde_json::json;

pub const LOCALES: [&str; 3] = ["pt-BR", "en", "es"];
const DAY: i64 = 86_400;

/// Account changes; `Some(None)` clears a setting.
#[derive(Debug, Clone, Default)]
pub struct AccountChanges {
    pub name: Option<String>,
    pub locale: Option<String>,
    /// Days without activity before an open conversation is resolved (1–999).
    pub auto_resolve_duration: Option<Option<i64>>,
    /// Message sent to the contact when a conversation is resolved for inactivity.
    pub auto_resolve_message: Option<Option<String>>,
}

impl HelpdeskService {
    pub fn account(&self) -> Result<Account> {
        self.core.repo.account()
    }

    pub fn update_account(&self, actor: &Actor, changes: &AccountChanges) -> Result<Account> {
        require_admin(actor)?;
        let mut settings = self.core.repo.account()?.settings;
        if !settings.is_object() {
            settings = json!({});
        }
        let entries = [
            ("auto_resolve_duration", changes.auto_resolve_duration.map(|d| json!(d))),
            (
                "auto_resolve_message",
                changes.auto_resolve_message.clone().map(|m| json!(m)),
            ),
        ];
        for (key, value) in entries {
            if let Some(value) = value {
                settings[key] = value;
            }
        }
        let account =
            self.core
                .repo
                .update_account(changes.name.as_deref(), changes.locale.as_deref(), Some(&settings))?;
        self.core.emit("account.updated", &account, Some(actor));
        Ok(account)
    }

    /// Resolves open/pending conversations idle for longer than the account's auto-resolve duration,
    /// optionally telling the contact first. Returns how many were resolved.
    pub async fn auto_resolve(&self) -> Result<usize> {
        let settings = self.core.repo.account()?.settings;
        let Some(days) = settings["auto_resolve_duration"].as_i64().filter(|d| *d > 0) else {
            return Ok(0);
        };
        let message = settings["auto_resolve_message"].as_str().map(str::to_string);
        let actor = Actor::system("auto_resolve", "Resolução automática");
        let mut resolved = 0;
        for id in self.core.repo.inactive_conversations(self.core.now() - days * DAY)? {
            let Some(conversation) = self.core.repo.conversation_by_id(id)? else {
                continue;
            };
            if let Some(text) = message.as_deref().filter(|m| !m.trim().is_empty()) {
                let _ = self.reply(&actor, conversation.display_id, text, false).await;
            }
            if self
                .toggle_status(&actor, conversation.display_id, "resolved", None)
                .is_ok()
            {
                resolved += 1;
            }
        }
        Ok(resolved)
    }
}
