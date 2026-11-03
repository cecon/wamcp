//! The GitHub channel: connecting a repository (token, webhook), turning its webhook deliveries
//! into conversations of the `github` inbox, and posting replies back as comments.
use super::core::Events;
use super::crypto::valid_hub_signature;
use super::github_connect::webhook_url;
use super::helpdesk::HelpdeskService;
use super::ports::SendRequest;
use crate::domain::actor::Actor;
use crate::domain::error::{fail_with, Result};
use crate::domain::github::{self, comment_target, marked, parse, GithubEvent, EVENTS, GITHUB};
use crate::domain::helpdesk::{initial_status, route_incoming, Route};
use crate::domain::model::{ContactChanges, ContactInbox, ConversationChanges as Changes, Inbox, Message, NewMessage};
use serde_json::{json, Value};

impl HelpdeskService {
    /// Tries again to create the webhook of a GitHub inbox that has none (administrators), with the
    /// stored token. Answers the setup, with `hook_error` when GitHub still refuses.
    pub async fn retry_github_hook(&self, actor: &Actor, inbox_id: i64, public_url: &str) -> Result<Value> {
        let mut setup = self.github_setup(actor, inbox_id, public_url)?;
        if setup["hook_created"] == true {
            return Ok(setup);
        }
        let Some(channel) = self.core.repo.github_channel(inbox_id)? else {
            return fail_with("Canal do GitHub não encontrado", 404);
        };
        let token = self.secrets.open(&channel.token)?;
        let secret = self.secrets.open(&channel.webhook_secret)?;
        let url = webhook_url(public_url, inbox_id);
        let hook_error = self
            .create_github_hook(inbox_id, &token, &channel.repo, &url, &secret)
            .await?;
        setup["hook_created"] = json!(hook_error.is_none());
        setup["hook_error"] = json!(hook_error);
        Ok(setup)
    }

    /// What GitHub sent to the channel's webhook, with the HTTP status of each delivery
    /// (administrators). Empty while no webhook exists: the UI explains how to create it.
    pub async fn github_deliveries(&self, actor: &Actor, inbox_id: i64) -> Result<Value> {
        if !actor.is_admin() {
            return fail_with("Apenas administradores veem as entregas do canal", 403);
        }
        let Some(channel) = self.core.repo.github_channel(inbox_id)? else {
            return fail_with("Canal do GitHub não encontrado", 404);
        };
        let Some(hook_id) = channel.hook_id else {
            return Ok(json!({ "hook_created": false, "deliveries": [] }));
        };
        let token = self.secrets.open(&channel.token)?;
        let raw = self.github.hook_deliveries(&token, &channel.repo, hook_id).await?;
        let deliveries: Vec<Value> = raw
            .as_array()
            .map(Vec::as_slice)
            .unwrap_or_default()
            .iter()
            .map(|d| {
                json!({
                    "id": d["id"],
                    "event": d["event"],
                    "action": d["action"],
                    "status": d["status_code"],
                    "duration_ms": d["duration"],
                    "delivered_at": d["delivered_at"],
                    "redelivery": d["redelivery"],
                })
            })
            .collect();
        Ok(json!({ "hook_created": true, "deliveries": deliveries }))
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
            "webhook_url": webhook_url(public_url, inbox_id),
            "webhook_secret": self.secrets.open(&channel.webhook_secret)?,
            "events": EVENTS,
            "hook_created": channel.hook_id.is_some(),
        }))
    }
}
