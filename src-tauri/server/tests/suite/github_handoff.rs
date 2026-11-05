//! The GitHub inbox's AI agent after a handoff: while nobody takes the conversation (it stays `open`
//! and unassigned), a new message on the repository must reach the channel's responsible agent again.
use crate::agents_support::{self, ai, profiles};
use crate::github_support::{connected, pr_opened, repository};
use async_trait::async_trait;
use parking_lot::Mutex;
use serde_json::json;
use std::sync::Arc;
use std::time::Duration;
use wamcp_server::adapters::outbound::llm::LlmRouter;
use wamcp_server::application::ports::{Completion, Llm, LlmRequest, TokenUsage};
use wamcp_server::domain::error::Result;

/// Always asks for a person: the first answer hands the conversation off, leaving it `open` and
/// unassigned. New messages must still reach the channel's AI agent.
#[derive(Default)]
struct Handoff {
    requests: Mutex<Vec<LlmRequest>>,
}

#[async_trait]
impl Llm for Handoff {
    async fn complete(&self, request: &LlmRequest) -> Result<Completion> {
        self.requests.lock().push(request.clone());
        Ok(Completion {
            answer: json!({ "reply": "Vou passar para a equipe.", "handoff": true }),
            usage: TokenUsage::default(),
        })
    }

    fn location(&self) -> Option<String> {
        Some("C:/bin/claude.exe".into())
    }
}

#[tokio::test]
async fn the_agent_keeps_answering_after_a_handoff_while_nobody_takes_the_conversation() {
    let mut c = connected().await;
    let handoff = Arc::new(Handoff::default());
    c.f.app.attach_llm(
        Arc::new(LlmRouter::default().with("claude_cli", handoff.clone())),
        Duration::ZERO,
    );
    let p = profiles(&c.admin).await;
    let jhon = c.admin.post("/agent_directory", ai(&p, "Jhon", "operator")).await.body["id"].clone();
    let linked = c
        .admin
        .post(
            &format!("/inboxes/{}/ai_agent", c.inbox),
            json!({ "ai_agent_id": jhon }),
        )
        .await;
    assert_eq!(linked.status, 200, "{:?}", linked.body);

    c.deliver("pull_request", "h1", &pr_opened(11), None).await;
    assert_eq!(handoff.requests.lock().len(), 1);
    let list = c.conversations().await;
    let conversation = &list[0];
    assert_eq!(
        conversation["status"], "open",
        "handoff abre a conversa: {conversation:?}"
    );
    assert!(
        conversation["assignee_id"].is_null(),
        "ninguém assumiu: {conversation:?}"
    );

    // A person comments on the PR afterwards: the responsible agent answers again.
    let comment = json!({ "action": "created", "sender": { "login": "maria" }, "repository": repository(),
        "issue": { "number": 11, "title": "Corrige login", "pull_request": {} }, "comment": { "body": "E agora?" } });
    c.deliver("issue_comment", "h2", &comment, None).await;
    println!("AFTER={:?}", c.conversations().await);
    assert_eq!(
        handoff.requests.lock().len(),
        2,
        "a conversa não pode ficar órfã após o handoff"
    );
    assert_eq!(c.f.github.comments.lock().len(), 2);
}
