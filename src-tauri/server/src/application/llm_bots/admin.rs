//! The system agent's turn: an administrator writing from the WhatsApp of their roster entry gets
//! an answer from the system agent, which calls the app's tools during its run.
use super::{LlmBotService, Responder};
use crate::application::ports::{LlmMcp, LlmRequest, ProgressSink};
use crate::domain::actor::Actor;
use crate::domain::error::{fail, Result};
use crate::domain::llm::agent_instructions;
use crate::domain::model::{chat_run_ref, Conversation, Message, RosterAgent, Thread, User};
use crate::domain::system::{build_system_prompt, reply_schema, MCP_NAME, SYSTEM_PROMPT, SYSTEM_TRANSCRIPT_LIMIT};

impl LlmBotService {
    /// The system agent and the administrator, when an administrator writes in the conversation and
    /// the system agent is active (otherwise the conversation follows the inbox as usual).
    pub(super) fn system_target(&self, conversation: &Conversation) -> Result<Option<(RosterAgent, User)>> {
        let Some(system) = &self.system else {
            return Ok(None);
        };
        if self.mcp_url.get().is_none() {
            return Ok(None);
        }
        let agent = self.helpdesk.core.repo.system_agent()?;
        let Some(agent) = agent.filter(|a| a.active && a.runtime.as_deref() == Some("claude_cli")) else {
            return Ok(None);
        };
        Ok(system.admin_of(conversation)?.map(|admin| (agent, admin)))
    }

    /// One turn of the system agent: it may call the app's tools while the run lasts, then its reply
    /// goes back to the administrator on WhatsApp.
    pub(super) async fn answer_admin(
        &self,
        conversation: &Conversation,
        agent: &RosterAgent,
        admin: User,
    ) -> Result<()> {
        let (Some(_), Some(url)) = (&self.system, self.mcp_url.get()) else {
            return Ok(());
        };
        let repo = &self.helpdesk.core.repo;
        let messages = repo.messages(conversation.id, None, SYSTEM_TRANSCRIPT_LIMIT)?;
        let last = messages
            .iter()
            .rev()
            .find(|m| !m.private && m.message_type != "activity");
        if last.is_none_or(|m| m.message_type != "incoming") {
            return Ok(());
        }
        let reply = self
            .system_turn(
                agent,
                admin,
                Thread::Conversation(conversation.id),
                &messages,
                url,
                &|_| {},
            )
            .await?;
        let actor = Actor::Bot {
            inbox_id: conversation.inbox_id,
        };
        self.helpdesk
            .reply(&actor, conversation.display_id, &reply, false)
            .await?;
        Ok(())
    }

    /// One run of the system agent for the administrator on `thread`: the app's tools are open to it
    /// while the run lasts, its steps go to `progress`, and its tokens count like any AI agent's (its own card in the panel).
    pub(super) async fn system_turn(
        &self,
        agent: &RosterAgent,
        admin: User,
        thread: Thread,
        messages: &[Message],
        url: &str,
        progress: ProgressSink<'_>,
    ) -> Result<String> {
        let Some(system) = &self.system else {
            return fail("O funcionário do sistema não está disponível");
        };
        let name = admin.display_name.clone().unwrap_or_else(|| admin.name.clone());
        let repo = &self.helpdesk.core.repo;
        let instructions = agent_instructions(agent, &repo.skills()?);
        // The tokens count in the chat session the run answers, even if the person opens another meanwhile.
        let (conversation, run_ref) = match thread {
            Thread::Conversation(id) => (Some(id), None),
            Thread::Chat(id) => (None, repo.agent_chat_by_id(id)?.map(|c| chat_run_ref(id, c.session))),
        };
        let token = system.open_run(thread, admin);
        let request = LlmRequest {
            provider: "claude_cli".into(),
            model: agent.model.clone(),
            system: SYSTEM_PROMPT.into(),
            prompt: build_system_prompt(&name, &instructions, messages),
            schema: reply_schema(),
            api_key: None,
            mcp: Some(LlmMcp {
                name: MCP_NAME.into(),
                url: url.into(),
                token: token.clone(),
            }),
        };
        let outcome = self.llm.complete_live(&request, progress).await;
        system.close_run(&token);
        let completion = outcome?;
        let responder = Responder {
            request,
            agent_id: Some(agent.id),
            agent_bot_id: None,
        };
        self.record(&responder, conversation, run_ref, completion.usage);
        let reply = completion.answer["reply"].as_str().map(str::trim).unwrap_or_default();
        if reply.is_empty() {
            return fail("O funcionário do sistema respondeu sem mensagem");
        }
        Ok(reply.to_string())
    }
}
