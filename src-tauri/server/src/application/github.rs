//! The GitHub channel: connecting a repository (token, webhook), turning its webhook deliveries
//! into conversations of the `github` inbox, and posting replies back as comments.
use super::core::Events;
use super::crypto::{random_secret, valid_hub_signature};
use super::helpdesk::HelpdeskService;
use super::ports::SendRequest;
use crate::domain::actor::Actor;
use crate::domain::error::{fail_with, Result};
use crate::domain::github::{self, comment_target, marked, parse, valid_repo, GithubEvent, EVENTS, GITHUB};
use crate::domain::helpdesk::{initial_status, route_incoming, Route};
use crate::domain::model::{
    ContactChanges, ContactInbox, ConversationChanges as Changes, GithubChannel, Inbox, Message, NewMessage,
};
use serde::Serialize;
use serde_json::{json, Value};

/// What the administrator needs after connecting: the inbox and the webhook, created by the app or
/// to be added by hand on GitHub when the token cannot create it.
#[derive(Debug, Serialize)]
pub struct GithubConnection {
    pub inbox: Inbox,
    pub webhook_url: String,
    pub webhook_secret: String,
    pub events: Vec<&'static str>,
    pub hook_created: bool,
    pub hook_error: Option<String>,
}

/// Path of a GitHub inbox's webhook, under the app's public address.
pub fn webhook_path(inbox_id: i64) -> String {
    format!("/api/github/{inbox_id}/webhook")
}

impl HelpdeskService {
    /// Connects `owner/repo` as a new inbox (administrators). The token is checked against GitHub
    /// and stored encrypted, as is the webhook secret.
    pub async fn connect_github(
        &self,
        actor: &Actor,
        name: &str,
        repo: &str,
        token: &str,
        public_url: &str,
    ) -> Result<GithubConnection> {
        if !actor.is_admin() {
            return fail_with("Apenas administradores conectam canais", 403);
        }
        let (name, repo, token) = (name.trim(), repo.trim().trim_matches('/'), token.trim());
        if name.is_empty() || name.chars().count() > 80 || !valid_repo(repo) || token.is_empty() || token.len() > 400 {
            return fail_with("Informe nome, repositório (dono/nome) e token", 422);
        }
        let own_login = self.github.login(token).await?;
        self.github.repository(token, repo).await?;
        let secret = random_secret();
        let channel = GithubChannel {
            inbox_id: 0,
            repo: repo.to_string(),
            token: self.secrets.seal(token)?,
            webhook_secret: self.secrets.seal(&secret)?,
            own_login: Some(own_login).filter(|l| !l.is_empty()),
            hook_id: None,
        };
        let inbox = self.core.commit(Some(actor), |_| {
            let inbox = self.core.repo.create_github_inbox(name, &channel)?;
            Ok(inbox)
        })?;
        let webhook_url = format!("{}{}", public_url.trim_end_matches('/'), webhook_path(inbox.id));
        let (hook_created, hook_error) = match self
            .github
            .create_hook(token, repo, &webhook_url, &secret, &EVENTS)
            .await
        {
            Ok(hook_id) => {
                self.core.repo.set_github_hook(inbox.id, hook_id)?;
                (true, None)
            }
            Err(error) => (false, Some(error.to_string())),
        };
        Ok(GithubConnection {
            inbox,
            webhook_url,
            webhook_secret: secret,
            events: EVENTS.to_vec(),
            hook_created,
            hook_error,
        })
    }

    /// One webhook delivery. Unsigned or wrongly signed deliveries are refused (401); events the
    /// channel does not follow are accepted and dropped.
    pub fn receive_github(
        &self,
        inbox_id: i64,
        event: &str,
        delivery: &str,
        signature: &str,
        body: &[u8],
    ) -> Result<Option<Message>> {
        let Some(channel) = self.core.repo.github_channel(inbox_id)? else {
            return fail_with("Canal não encontrado", 404);
        };
        let secret = self.secrets.open(&channel.webhook_secret)?;
        if !valid_hub_signature(&secret, body, signature) {
            return fail_with("Assinatura inválida", 401);
        }
        let Ok(payload) = serde_json::from_slice::<Value>(body) else {
            return fail_with("Corpo inválido", 400);
        };
        let Some(parsed) = parse(event, &payload) else {
            return Ok(None);
        };
        // Deliveries of another repository (a hook copied by mistake) do not belong here.
        if !parsed.thread.source_id.starts_with(&format!("{}#", channel.repo))
            && parsed.thread.source_id != github::activity_source(&channel.repo)
        {
            return Ok(None);
        }
        let inbox = self.core.inbox(inbox_id)?;
        self.core.commit(Some(&Actor::contact()), |events| {
            self.store_github(&inbox, delivery, &parsed, events)
        })
    }

    fn github_contact(&self, inbox: &Inbox, event: &GithubEvent, events: &mut Events) -> Result<ContactInbox> {
        let repo = &self.core.repo;
        if let Some(existing) = repo.contact_inbox(inbox.id, &event.thread.source_id)? {
            return Ok(existing);
        }
        let contact = repo.create_contact(Some(&event.thread.title), None)?;
        let contact = repo.update_contact(
            contact.id,
            &ContactChanges {
                identifier: Some(event.thread.url.clone()),
                ..Default::default()
            },
        )?;
        events.push("contact.created", &contact);
        repo.create_contact_inbox(contact.id, inbox.id, &event.thread.source_id)
    }

    fn store_github(
        &self,
        inbox: &Inbox,
        delivery: &str,
        event: &GithubEvent,
        events: &mut Events,
    ) -> Result<Option<Message>> {
        let (core, repo) = (&self.core, &self.core.repo);
        let source_id = format!("github:{delivery}");
        if delivery.is_empty() || repo.message_by_source(inbox.id, &source_id)?.is_some() {
            return Ok(None);
        }
        let ci = self.github_contact(inbox, event, events)?;
        let now = core.clock.now();
        let latest = repo.latest_conversation(ci.id)?;
        let status =
            initial_status(inbox.agent_bot_enabled != 0 || inbox.agent_bot_id.is_some() || inbox.ai_agent_id.is_some());
        let conversation = match (route_incoming(latest.as_ref(), inbox), latest) {
            (Route::Ignore, _) => return Ok(None),
            (Route::Reuse { reopen: false }, Some(latest)) => latest,
            (Route::Reuse { reopen: true }, Some(latest)) => {
                let changes = Changes {
                    status: Some(status.into()),
                    snoozed_until: Some(None),
                    ..Default::default()
                };
                let reopened = core.update(latest.id, changes)?;
                events.push("conversation.status_changed", &reopened);
                reopened
            }
            _ => {
                let created = repo.create_conversation(inbox.id, &ci, status, now)?;
                events.push("conversation.created", &created);
                created
            }
        };
        let message = repo.insert_message(&NewMessage {
            conversation_id: conversation.id,
            inbox_id: inbox.id,
            message_type: "incoming".into(),
            content: Some(event.text.clone()),
            content_type: Some("text".into()),
            sender_type: Some("contact".into()),
            sender_id: Some(ci.contact_id),
            source_id: Some(source_id),
            content_attributes: json!({ "github_sender": event.sender, "url": event.thread.url }),
            created_at: now,
            ..NewMessage::default()
        })?;
        if let Some(message) = &message {
            events.push("message.created", message);
        }
        let changes = Changes {
            last_activity_at: Some(conversation.last_activity_at.max(now)),
            waiting_since: Some(Some(conversation.waiting_since.unwrap_or(now))),
            ..Default::default()
        };
        let updated = core.update(conversation.id, changes)?;
        core.auto_assign(updated, events)?;
        Ok(message)
    }

    /// Sends a stored reply through the inbox's channel.
    pub(crate) async fn send_out(&self, message: &Message, inbox: &Inbox, request: SendRequest) -> Result<String> {
        if inbox.channel_type != GITHUB {
            let request = self.sign_for_whatsapp(message, inbox, request);
            return self.whatsapp.send_message(&inbox.session_id, &request).await;
        }
        if request.media.is_some() {
            return fail_with("Anexos não vão para o GitHub; escreva a resposta em texto", 422);
        }
        let text = request.text.unwrap_or_default();
        self.comment_on_github(inbox, &request.jid, &text).await?;
        Ok(String::new())
    }

    /// Posts a reply as a comment on the conversation's pull request or issue. The repository's
    /// activity conversation has nowhere to post: its replies stay in the app.
    pub(crate) async fn comment_on_github(&self, inbox: &Inbox, source: &str, text: &str) -> Result<()> {
        let Some((_, number)) = comment_target(source) else {
            return Ok(());
        };
        let Some(channel) = self.core.repo.github_channel(inbox.id)? else {
            return fail_with("Canal do GitHub não encontrado", 422);
        };
        let token = self.secrets.open(&channel.token)?;
        self.github
            .comment(&token, &channel.repo, number, &marked(text))
            .await
            .map(|_| ())
    }
}

impl HelpdeskService {
    /// The webhook of a GitHub inbox, to add it on GitHub by hand (administrators).
    pub fn github_setup(&self, actor: &Actor, inbox_id: i64, public_url: &str) -> Result<Value> {
        if !actor.is_admin() {
            return fail_with("Apenas administradores veem a configuração do canal", 403);
        }
        let Some(channel) = self.core.repo.github_channel(inbox_id)? else {
            return fail_with("Canal do GitHub não encontrado", 404);
        };
        Ok(json!({
            "repo": channel.repo,
            "account": channel.own_login,
            "webhook_url": format!("{}{}", public_url.trim_end_matches('/'), webhook_path(inbox_id)),
            "webhook_secret": self.secrets.open(&channel.webhook_secret)?,
            "events": EVENTS,
            "hook_created": channel.hook_id.is_some(),
        }))
    }
}
