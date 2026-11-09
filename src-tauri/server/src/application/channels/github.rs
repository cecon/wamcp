//! The GitHub channel: replies become comments on the conversation's pull request or issue, as
//! the repository's token or the GitHub App. Text only.
use super::{Address, Channel};
use crate::application::helpdesk::HelpdeskService;
use crate::application::ports::SendRequest;
use crate::domain::channel::{capabilities, Capabilities};
use crate::domain::error::{fail_with, Result};
use crate::domain::github::{comment_target, marked, GITHUB};
use crate::domain::model::Message;
use async_trait::async_trait;

pub struct GithubChannel;

#[async_trait]
impl Channel for GithubChannel {
    fn capabilities(&self) -> Capabilities {
        capabilities(GITHUB)
    }

    /// The repository's activity conversation has nowhere to post: its replies stay in the app.
    async fn send(
        &self,
        helpdesk: &HelpdeskService,
        _: &Message,
        to: Address<'_>,
        request: SendRequest,
    ) -> Result<String> {
        if request.media.is_some() {
            return fail_with("Anexos não vão para o GitHub; escreva a resposta em texto", 422);
        }
        let Some((_, number)) = comment_target(&request.jid) else {
            return Ok(String::new());
        };
        let Some(channel) = helpdesk.core.repo.github_channel(to.inbox.id)? else {
            return fail_with("Canal do GitHub não encontrado", 422);
        };
        let token = helpdesk.github_token(&channel).await?;
        let text = request.text.unwrap_or_default();
        helpdesk
            .github
            .comment(&token, &channel.repo, number, &marked(&text))
            .await?;
        Ok(String::new())
    }
}
