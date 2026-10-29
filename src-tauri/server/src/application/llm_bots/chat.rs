//! A person's chat with an AI agent in the app: each message of the person gets the agent's answer
//! through its runtime, with its instructions and skills (the system agent, for administrators, with
//! the app's tools). Its steps reach the person live (`agent_chat.progress`) and a failure is stored
//! in the chat too, so the person sees why there is no answer.
use super::{LlmBotService, Responder};
use crate::application::agent_chats::post_chat_message;
use crate::application::ports::{LlmRequest, Progress, ProgressSink};
use crate::domain::agent_context::{agent_context, AgentChannel, Workplace, RECENT_CONVERSATIONS};
use crate::domain::error::{fail, Result};
use crate::domain::llm::{
    agent_instructions, build_chat_prompt, chat_schema, chats_with, openrouter_key, CHAT_SYSTEM, CHAT_TRANSCRIPT_LIMIT,
};
use crate::domain::model::{
    AgentChat, ConversationFilters, Message, RosterAgent, Thread, User, CHAT_AGENT, CHAT_ERROR, CHAT_USER,
};
use serde_json::json;

impl LlmBotService {
    /// Answers the newest message of the chat, if it is the person's (an earlier run may have answered).
    pub(super) async fn answer_chat(&self, chat_id: i64) -> Result<()> {
        let repo = &self.helpdesk.core.repo;
        let Some(chat) = repo.agent_chat_by_id(chat_id)? else {
            return Ok(());
        };
        let history = repo.chat_messages(chat.id, CHAT_TRANSCRIPT_LIMIT)?;
        if history.last().is_none_or(|m| m.role != CHAT_USER) {
            return Ok(());
        }
        let messages: Vec<Message> = history.iter().map(|m| m.as_message()).collect();
        let core = &self.helpdesk.core;
        let progress = |step: Progress| {
            let event = json!({ "chat_id": chat.id, "user_id": chat.user_id, "agent_id": chat.agent_id, "step": step });
            core.emit("agent_chat.progress", &event, None);
        };
        let (role, content) = match self.chat_turn(&chat, &messages, &progress).await {
            Ok(reply) => (CHAT_AGENT, reply),
            Err(error) => (CHAT_ERROR, format!("Não consegui responder: {error}")),
        };
        post_chat_message(&self.helpdesk.core, chat.id, role, &content)?;
        Ok(())
    }

    async fn chat_turn(&self, chat: &AgentChat, messages: &[Message], progress: ProgressSink<'_>) -> Result<String> {
        let repo = &self.helpdesk.core.repo;
        let (Some(agent), Some(user)) = (repo.agent(chat.agent_id)?, repo.user(chat.user_id)?) else {
            return fail("O agente ou a pessoa não existe mais");
        };
        // Checked again at answer time: the agent may have been turned off, or the login demoted.
        if user.active != 1 || !chats_with(&agent, user.role == "administrator") {
            return fail("este agente não está disponível para conversa");
        }
        if agent.system {
            let Some(url) = self.mcp_url.get() else {
                return fail("o funcionário do sistema ainda não está pronto");
            };
            return self
                .system_turn(&agent, user, Thread::Chat(chat.id), messages, url, progress)
                .await;
        }
        let credentials = repo.agent_sealed_credentials(agent.id)?;
        let api_key = match openrouter_key(&credentials) {
            Some(credential) => Some(self.secrets.open(&credential.secret)?),
            None => None,
        };
        let person = user.display_name.clone().unwrap_or_else(|| user.name.clone());
        let instructions = agent_instructions(&agent, &repo.skills()?);
        let request = LlmRequest {
            provider: agent.runtime.clone().unwrap_or_default(),
            model: agent.model.clone(),
            system: CHAT_SYSTEM.into(),
            prompt: build_chat_prompt(&person, &self.about(&agent, &user)?, &instructions, messages),
            schema: chat_schema(),
            api_key,
            mcp: None,
        };
        let completion = self.llm.complete_live(&request, progress).await?;
        let responder = Responder {
            request,
            agent_id: Some(agent.id),
            agent_bot_id: None,
        };
        self.record(
            &responder,
            None,
            Some(format!("agent_chat:{}", chat.id)),
            completion.usage,
        );
        let reply = completion.answer["reply"].as_str().map(str::trim).unwrap_or_default();
        if reply.is_empty() {
            return fail("o agente respondeu sem mensagem");
        }
        Ok(reply.into())
    }

    /// Who the agent is, where and with whom it works, and the channels it answers, with their newest conversations when the person
    /// may see that inbox (administrators see every inbox, others only the ones they belong to).
    fn about(&self, agent: &RosterAgent, user: &User) -> Result<String> {
        let repo = &self.helpdesk.core.repo;
        let visible = match user.role.as_str() {
            "administrator" => None,
            _ => Some(repo.member_inbox_ids(user.id)?),
        };
        let mut channels = Vec::new();
        for inbox in repo.inboxes(None)? {
            if inbox.ai_agent_id != Some(agent.id) {
                continue;
            }
            let recent = if visible.as_ref().is_none_or(|ids| ids.contains(&inbox.id)) {
                let filters = ConversationFilters {
                    inbox_id: Some(inbox.id),
                    ..Default::default()
                };
                let mut list = repo.conversations(&filters)?;
                list.truncate(RECENT_CONVERSATIONS);
                list
            } else {
                Vec::new()
            };
            channels.push(AgentChannel { inbox, recent });
        }
        let (account, team) = (repo.account()?, repo.agents()?);
        let workplace = Workplace {
            company: &account.name,
            team: &team,
        };
        Ok(agent_context(agent, &workplace, &channels))
    }
}
