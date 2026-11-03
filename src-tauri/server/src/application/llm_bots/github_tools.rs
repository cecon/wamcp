//! The call of an inbox's agent. On a GitHub inbox answered with Claude Code, the repository's
//! tools are open to the run (`/mcp-github`, next to the system agent's endpoint on this computer).
use super::LlmBotService;
use crate::application::github_agent::GithubRun;
use crate::application::ports::{Completion, LlmMcp, LlmRequest};
use crate::domain::error::Result;
use crate::domain::github_tools::{MCP_NAME, TOOLS_PROMPT};
use crate::domain::model::{Conversation, Inbox};

impl LlmBotService {
    /// Asks the runtime for the answer. Also says whether the agent forwarded the conversation to
    /// its supervisor during the run (the human team takes over once the answer is out).
    pub(super) async fn complete_for(
        &self,
        inbox: &Inbox,
        conversation: &Conversation,
        mut request: LlmRequest,
        agent_id: Option<i64>,
    ) -> Result<(Completion, bool)> {
        let url = self.mcp_url.get().map(|url| url.replace("/mcp-system", "/mcp-github"));
        let Some(url) = url.filter(|_| inbox.github_repo.is_some() && request.provider == "claude_cli") else {
            return Ok((self.llm.complete(&request).await?, false));
        };
        let helpdesk = &self.helpdesk;
        let token = helpdesk.open_github_run(GithubRun {
            inbox_id: inbox.id,
            display_id: conversation.display_id,
            source_id: conversation.contact_jid.clone(),
            agent_id,
            handoff: false,
        });
        request.system = format!("{}\n\n{TOOLS_PROMPT}", request.system);
        request.mcp = Some(LlmMcp {
            name: MCP_NAME.into(),
            url,
            token: token.clone(),
        });
        let outcome = self.llm.complete(&request).await;
        let forwarded = helpdesk.close_github_run(&token).is_some_and(|run| run.handoff);
        Ok((outcome?, forwarded))
    }
}
