//! The GitHub channel: connecting a repository (token, webhook), turning its webhook deliveries
//! into conversations of the `github` inbox, and posting replies back as comments.
use super::core::Events;
use super::crypto::{random_secret, valid_hub_signature};
use super::helpdesk::HelpdeskService;
use super::inbound::Incoming;
use crate::domain::actor::Actor;
use crate::domain::error::{fail_with, Result};
use crate::domain::github::{self, parse, valid_repo, GithubEvent, EVENTS};
use crate::domain::helpdesk::route_incoming;
use crate::domain::model::{ContactChanges, ContactInbox, GithubChannel, Inbox, Message, NewMessage};
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

pub(crate) fn webhook_url(public_url: &str, inbox_id: i64) -> String {
    format!("{}{}", public_url.trim_end_matches('/'), webhook_path(inbox_id))
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
            installation_id: None,
        };
        let inbox = self.core.commit(Some(actor), |_| {
            let inbox = self.core.repo.create_github_inbox(name, &channel)?;
            Ok(inbox)
        })?;
        let webhook_url = webhook_url(public_url, inbox.id);
        let hook_error = self
            .create_github_hook(inbox.id, token, repo, &webhook_url, &secret)
            .await?;
        let hook_created = hook_error.is_none();
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
        let Some(channel) = self
            .core
            .repo
            .github_channel(inbox_id)?
            .filter(|c| !c.webhook_secret.is_empty())
        else {
            return fail_with("Canal não encontrado", 404);
        };
        let secret = self.secrets.open(&channel.webhook_secret)?;
        if !valid_hub_signature(&secret, body, signature) {
            return fail_with("Assinatura inválida", 401);
        }
        let Ok(payload) = serde_json::from_slice::<Value>(body) else {
            return fail_with("Corpo inválido", 400);
        };
        self.ingest_github(&channel, event, delivery, &payload)
    }

    /// A verified delivery of `channel`'s repository, from its own hook or from the GitHub App.
    pub(crate) fn ingest_github(
        &self,
        channel: &GithubChannel,
        event: &str,
        delivery: &str,
        payload: &Value,
    ) -> Result<Option<Message>> {
        let Some(parsed) = parse(event, payload) else {
            return Ok(None);
        };
        // Deliveries of another repository (a hook copied by mistake) do not belong here.
        let repo = channel.repo.to_ascii_lowercase();
        let source = parsed.thread.source_id.to_ascii_lowercase();
        if !source.starts_with(&format!("{repo}#")) && source != github::activity_source(&repo) {
            return Ok(None);
        }
        let inbox = self.core.inbox(channel.inbox_id)?;
        self.core
            .commit(Some(&Actor::contact()), |events| match self.take_github_echo(&parsed) {
                true => self.note_github_echo(&inbox, &parsed, events).map(|_| None),
                false => self.store_github(&inbox, delivery, &parsed, events),
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
        let incoming = Incoming {
            inbox,
            contact_inbox: &ci,
            route: route_incoming(latest.as_ref(), inbox),
            latest,
            at: now,
            awaits_team: true,
        };
        self.receive(incoming, events, |conversation, events| {
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
            Ok(message)
        })
    }
}
