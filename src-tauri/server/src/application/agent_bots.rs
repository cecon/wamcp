//! Agent bots (Chatwoot's webhook bots): administrators register a bot URL, connect inboxes to it,
//! and the bot receives their events and answers through the API with its access token. New
//! conversations in a bot inbox start `pending` until the bot hands them off (status `open`).
use super::helpdesk::HelpdeskService;
use super::webhooks::WebhookService;
use crate::domain::actor::Actor;
use crate::domain::error::{fail_with, HelpdeskError, Result};
use crate::domain::helpdesk::require_admin;
use crate::domain::model::{AgentBot, Delivery, Inbox};
use crate::domain::webhooks::validate_webhook;
use serde_json::{json, Value};

/// Fields of a bot; `None` keeps the current value on update.
#[derive(Debug, Clone, Default)]
pub struct BotFields {
    pub name: Option<String>,
    pub description: Option<Option<String>>,
    pub outgoing_url: Option<String>,
}

fn check_url(url: &str) -> Result<()> {
    validate_webhook(url, &["message_created".to_string()])
}

impl WebhookService {
    fn find_bot(&self, id: i64) -> Result<AgentBot> {
        self.core
            .repo
            .agent_bot(id)?
            .ok_or_else(|| HelpdeskError::not_found("Robô não encontrado").into())
    }

    pub fn agent_bots(&self, actor: &Actor) -> Result<Vec<AgentBot>> {
        require_admin(actor)?;
        self.core.repo.agent_bots()
    }

    /// Creates the bot and returns it with its access token (shown only now).
    pub fn create_agent_bot(&self, actor: &Actor, fields: &BotFields) -> Result<Value> {
        require_admin(actor)?;
        let url = fields.outgoing_url.clone().unwrap_or_default();
        check_url(&url)?;
        let name = fields.name.clone().unwrap_or_default();
        let description = fields.description.clone().flatten();
        let bot = self
            .core
            .repo
            .create_agent_bot(&name, description.as_deref(), &url, &self.sender.secret())?;
        let token = self.core.repo.issue_api_token("agent_bot", bot.id)?;
        Ok(json!({ "agent_bot": bot, "access_token": token }))
    }

    pub fn update_agent_bot(&self, actor: &Actor, id: i64, fields: &BotFields) -> Result<AgentBot> {
        require_admin(actor)?;
        self.find_bot(id)?;
        if let Some(url) = &fields.outgoing_url {
            check_url(url)?;
        }
        let description = fields.description.as_ref().map(Option::as_deref);
        self.core
            .repo
            .update_agent_bot(id, fields.name.as_deref(), description, fields.outgoing_url.as_deref())
    }

    pub fn delete_agent_bot(&self, actor: &Actor, id: i64) -> Result<()> {
        require_admin(actor)?;
        self.find_bot(id)?;
        self.core.repo.delete_agent_bot(id)
    }

    /// Replaces the bot's access token (the old one stops working).
    pub fn reset_bot_token(&self, actor: &Actor, id: i64) -> Result<Value> {
        require_admin(actor)?;
        self.find_bot(id)?;
        Ok(json!({ "access_token": self.core.repo.issue_api_token("agent_bot", id)? }))
    }

    pub fn bot_deliveries(&self, actor: &Actor, id: i64) -> Result<Vec<Delivery>> {
        require_admin(actor)?;
        let bot = self.find_bot(id)?;
        self.core.repo.deliveries(bot.webhook_id, 20)
    }

    /// Connects an inbox to a bot (or disconnects it with `None`).
    pub fn set_inbox_bot(&self, actor: &Actor, inbox_id: i64, bot_id: Option<i64>) -> Result<Inbox> {
        require_admin(actor)?;
        self.core.inbox(inbox_id)?;
        if let Some(id) = bot_id {
            self.find_bot(id)?;
        }
        self.core.repo.set_inbox_agent_bot(inbox_id, bot_id)?;
        self.core.inbox(inbox_id)
    }
}

impl HelpdeskService {
    /// The actor for an agent bot acting on a conversation of one of its inboxes.
    pub fn bot_actor(&self, bot_id: i64, display_id: i64) -> Result<Actor> {
        let conversation = self.core.load(None, display_id)?;
        let inbox = self.core.inbox(conversation.inbox_id)?;
        if inbox.agent_bot_id != Some(bot_id) {
            return fail_with("Este robô não atende esta caixa de entrada", 403);
        }
        Ok(Actor::Bot { inbox_id: inbox.id })
    }

    pub fn is_agent_bot_token(&self, token: &str) -> Result<Option<i64>> {
        let owner = self.core.repo.api_token_owner(token)?;
        Ok(owner.filter(|o| o.owner_type == "agent_bot").map(|o| o.owner_id))
    }
}
