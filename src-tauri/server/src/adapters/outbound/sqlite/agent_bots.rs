use super::db::{int, iso, now_ms, opt_int, opt_text, text, Shape, SqliteStore};
use crate::application::ports::{AgentBotRepo, LlmChanges, NewAgentBot};
use crate::domain::error::{Error, Result};
use crate::domain::model::{AgentBot, BOT_WEBHOOK};

const BOT: &str = "SELECT b.id, b.name, b.description, w.url AS outgoing_url, b.webhook_id, b.created,
  (SELECT json_group_array(i.id) FROM inboxes i WHERE i.agent_bot_id=b.id) AS inbox_ids, b.kind, b.provider, b.model, b.instructions
  FROM agent_bots b JOIN webhooks w ON w.id=b.webhook_id";
const SHAPE: Shape = Shape {
    json: &["inbox_ids"],
    bools: &[],
};
/// Events an agent bot receives (Chatwoot sends the conversation and message lifecycle).
const BOT_EVENTS: &str = r#"["conversation_created","conversation_status_changed","conversation_updated","message_created","message_updated"]"#;

impl AgentBotRepo for SqliteStore {
    fn agent_bots(&self) -> Result<Vec<AgentBot>> {
        self.rows(&format!("{BOT} ORDER BY b.name COLLATE NOCASE"), vec![], SHAPE)
    }

    fn agent_bot(&self, id: i64) -> Result<Option<AgentBot>> {
        self.row(&format!("{BOT} WHERE b.id=?"), vec![int(id)], SHAPE)
    }

    fn create_agent_bot(&self, bot: &NewAgentBot) -> Result<AgentBot> {
        let created = text(iso(now_ms()));
        let active = int(i64::from(bot.kind == BOT_WEBHOOK));
        let webhook = self.insert(
            "INSERT INTO webhooks(url,subscriptions,secret,kind,active,created) VALUES(?,?,?,'agent_bot',?,?)",
            vec![
                text(&bot.url),
                text(BOT_EVENTS),
                text(&bot.secret),
                active,
                created.clone(),
            ],
        )?;
        let id = self.insert(
            "INSERT INTO agent_bots(name,description,webhook_id,kind,provider,model,instructions,created) VALUES(?,?,?,?,?,?,?,?)",
            vec![
                text(&bot.name),
                opt_text(bot.description.as_deref()),
                int(webhook),
                text(&bot.kind),
                opt_text(bot.provider.as_deref()),
                opt_text(bot.model.as_deref()),
                opt_text(bot.instructions.as_deref()),
                created,
            ],
        )?;
        self.agent_bot(id)?.ok_or_else(|| Error::internal("agent bot vanished"))
    }

    fn update_agent_bot(
        &self,
        id: i64,
        name: Option<&str>,
        description: Option<Option<&str>>,
        url: Option<&str>,
        llm: &LlmChanges,
    ) -> Result<AgentBot> {
        let mut fields = Vec::new();
        if let Some(name) = name {
            fields.push(("name", text(name)));
        }
        if let Some(description) = description {
            fields.push(("description", opt_text(description)));
        }
        for (column, value) in [
            ("provider", &llm.provider),
            ("model", &llm.model),
            ("instructions", &llm.instructions),
        ] {
            if let Some(value) = value {
                fields.push((column, opt_text(value.as_deref())));
            }
        }
        self.update_fields("agent_bots", int(id), fields)?;
        if let Some(url) = url {
            let sql = "UPDATE webhooks SET url=? WHERE id=(SELECT webhook_id FROM agent_bots WHERE id=?)";
            self.exec(sql, vec![text(url), int(id)])?;
        }
        self.agent_bot(id)?.ok_or_else(|| Error::internal("agent bot vanished"))
    }

    fn delete_agent_bot(&self, id: i64) -> Result<()> {
        let sql = "DELETE FROM webhooks WHERE id=(SELECT webhook_id FROM agent_bots WHERE id=?)";
        self.exec(sql, vec![int(id)])?;
        let tokens = "DELETE FROM api_access_tokens WHERE owner_type='agent_bot' AND owner_id=?";
        self.exec(tokens, vec![int(id)]).map(drop)
    }

    fn set_inbox_agent_bot(&self, inbox_id: i64, agent_bot_id: Option<i64>) -> Result<()> {
        let sql = "UPDATE inboxes SET agent_bot_id=? WHERE id=?";
        self.exec(sql, vec![opt_int(agent_bot_id), int(inbox_id)]).map(drop)
    }
}
