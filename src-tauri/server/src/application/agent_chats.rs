//! Chats of people logged in to the app with AI agents: private (only the person sees them), away
//! from WhatsApp and from the customers' conversations. The person's message goes to the bus, and
//! the LLM bots answer it through the agent's runtime (see `llm_bots/chat.rs`). A chat has sessions:
//! the person ends one and starts another, and each spends up to `SESSION_TOKEN_LIMIT` tokens.
use super::core::Core;
use crate::domain::error::{fail, HelpdeskError, Result};
use crate::domain::llm::{chats_with, CHAT_TRANSCRIPT_LIMIT};
use crate::domain::model::{
    session_full, AgentChat, ChatMessage, RosterAgent, User, CHAT_USER, SESSION_FULL, SESSION_TOKEN_LIMIT,
};
use crate::domain::salary::SalaryRates;
use serde_json::{json, Value};

/// Longest message a person may send.
const MAX_MESSAGE: usize = 4000;

#[derive(Clone)]
pub struct AgentChatService {
    pub core: Core,
}

/// Stores a chat message and tells the bus (`agent_chat.message`, seen only by the chat's person).
pub fn post_chat_message(core: &Core, chat_id: i64, role: &str, content: &str) -> Result<ChatMessage> {
    let message = core
        .repo
        .add_chat_message(chat_id, role, content, core.clock.now_ms())?;
    core.emit("agent_chat.message", &message, None);
    Ok(message)
}

fn administrator(user: &User) -> bool {
    user.role == "administrator"
}

impl AgentChatService {
    /// The AI agents the person may talk to (the system agent first, for administrators), each with
    /// the newest message of their chat. Only what the chat list shows: no instructions or secrets.
    pub fn contacts(&self, user: &User) -> Result<Value> {
        let repo = &self.core.repo;
        let last = repo.last_chat_messages(user.id)?;
        let mut agents: Vec<RosterAgent> = repo
            .agents()?
            .into_iter()
            .filter(|a| chats_with(a, administrator(user)))
            .collect();
        agents.sort_by_key(|a| (!a.system, a.name.to_lowercase()));
        Ok(json!(agents
            .iter()
            .map(|a| json!({
                "id": a.id,
                "name": a.name,
                "description": a.description,
                "role": a.role,
                "profile_name": a.profile_name,
                "runtime": a.runtime,
                "model": a.model,
                "system": a.system,
                "avatar": a.avatar,
                "last": last.iter().find(|m| m.agent_id == a.id),
            }))
            .collect::<Vec<_>>()))
    }

    /// The agent the person may talk to, or 404 (an agent they may not use is not shown at all).
    fn agent(&self, user: &User, agent_id: i64) -> Result<RosterAgent> {
        match self.core.repo.agent(agent_id)? {
            Some(agent) if chats_with(&agent, administrator(user)) => Ok(agent),
            _ => Err(HelpdeskError::not_found("Agente não encontrado").into()),
        }
    }

    /// The newest messages of a session of the person's chat with the agent (the open one by default), oldest first.
    pub fn messages(&self, user: &User, agent_id: i64, session: Option<i64>) -> Result<Vec<ChatMessage>> {
        let agent = self.agent(user, agent_id)?;
        let chat = self.core.repo.agent_chat(user.id, agent.id)?;
        let session = session.unwrap_or(chat.session);
        self.core.repo.session_messages(chat.id, session, CHAT_TRANSCRIPT_LIMIT)
    }

    /// The sessions of the person's chat with the agent, newest first, with the tokens each spent and
    /// their cost in reais (as in the agent's salary).
    pub fn sessions(&self, user: &User, agent_id: i64) -> Result<Value> {
        let agent = self.agent(user, agent_id)?;
        let chat = self.core.repo.agent_chat(user.id, agent.id)?;
        self.sessions_of(&chat)
    }

    /// Ends the open session (if it has messages) and opens a new one, which the agent sees from scratch.
    pub fn new_session(&self, user: &User, agent_id: i64) -> Result<Value> {
        let agent = self.agent(user, agent_id)?;
        let chat = self.core.repo.agent_chat(user.id, agent.id)?;
        let chat = self.core.repo.new_chat_session(chat.id)?;
        self.sessions_of(&chat)
    }

    fn sessions_of(&self, chat: &AgentChat) -> Result<Value> {
        let rate = SalaryRates::from_settings(&self.core.repo.account()?.settings).ai_brl_per_usd();
        let sessions = self.core.repo.chat_sessions(chat.id)?;
        Ok(json!({
            "current": chat.session,
            "token_limit": SESSION_TOKEN_LIMIT,
            "sessions": sessions.iter().map(|s| {
                let mut value = json!(s);
                value["cost_brl"] = json!((s.cost_usd * rate * 100.0).round() / 100.0);
                value["full"] = json!(session_full(s.tokens));
                value
            }).collect::<Vec<_>>(),
        }))
    }

    /// The person writes to the agent; the answer arrives later as another `agent_chat.message`.
    pub fn send(&self, user: &User, agent_id: i64, content: &str) -> Result<ChatMessage> {
        let content = content.trim();
        if content.is_empty() || content.chars().count() > MAX_MESSAGE {
            return fail(format!("A mensagem precisa ter entre 1 e {MAX_MESSAGE} caracteres"));
        }
        let agent = self.agent(user, agent_id)?;
        let chat = self.core.repo.agent_chat(user.id, agent.id)?;
        let sessions = self.core.repo.chat_sessions(chat.id)?;
        if sessions
            .iter()
            .any(|s| s.number == chat.session && session_full(s.tokens))
        {
            return fail(SESSION_FULL);
        }
        post_chat_message(&self.core, chat.id, CHAT_USER, content)
    }
}
