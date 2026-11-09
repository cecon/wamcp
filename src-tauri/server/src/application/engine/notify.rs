//! The chain of a request closes: whoever asked hears how it ended (or that it waits for an approval)
//! in their own channel, and so do the copies they added. A customer's conversation is answered by
//! `concluir` and `fail_activity`; these are the people and contacts.
use super::submit::Submission;
use super::EngineService;
use crate::domain::engine::activity as status;
use crate::domain::engine::model::Activity;
use crate::domain::engine::recipients::{
    self as recipients, message, notifies, requester_recipient, Delivery, Outcome,
};
use crate::domain::error::{fail, Result};
use serde_json::json;

/// Copies go to people of the app or contacts, at most `MAX_COPIES`.
pub(super) fn check_copies(copies: &[(String, i64)]) -> Result<()> {
    if copies.len() > recipients::MAX_COPIES {
        return fail(format!("Até {} cópias por pedido", recipients::MAX_COPIES));
    }
    if copies
        .iter()
        .any(|(kind, _)| ![recipients::USER, recipients::CONTACT].contains(&kind.as_str()))
    {
        return fail("Cópias vão para pessoas do app (`user`) ou contatos (`contact`)");
    }
    Ok(())
}

impl EngineService {
    /// Who hears about a new root activity: the requester (or the chat it came from) and the copies.
    pub(super) fn add_recipients(&self, activity: &Activity, s: &Submission) -> Result<()> {
        let account = activity.account_id;
        match (s.reply_chat, requester_recipient(&s.requester)) {
            (Some(chat), _) => self
                .store
                .add_recipient(account, activity.id, recipients::CHAT, chat, false, None)?,
            (None, Some((kind, id))) => self.store.add_recipient(account, activity.id, kind, id, false, None)?,
            (None, None) => {}
        }
        for (kind, id) in &s.copies {
            self.store.add_recipient(account, activity.id, kind, *id, true, None)?;
        }
        Ok(())
    }

    /// Tells each recipient of a root activity about its current state, once per state. A delivery
    /// that fails is recorded on the recipient (the request's screen shows it), never retried in a loop.
    pub async fn notify_recipients(&self, account_id: i64, id: i64) -> Result<()> {
        let activity = self.load(account_id, id)?;
        if activity.parent_id.is_some() || !notifies(&activity.status) {
            return Ok(());
        }
        let agent = match self.store.engine_agent(account_id, activity.agent_id)? {
            Some(agent) => agent.name,
            None => format!("agente #{}", activity.agent_id),
        };
        let outcome = Outcome {
            activity_id: activity.id,
            agent: &agent,
            request: &activity.request,
            status: &activity.status,
            result: activity.result.as_deref(),
            error: activity.error.as_deref(),
        };
        for recipient in self.store.recipients(account_id, activity.id)? {
            if !self.store.claim_recipient(recipient.id, &activity.status)? {
                continue;
            }
            let delivery = Delivery {
                kind: recipient.kind.clone(),
                target_id: recipient.target_id,
                agent_id: activity.agent_id,
                failed: activity.status == status::FAILED,
                text: message(&recipient.kind, recipient.copy, &outcome),
            };
            let detail = json!({"para": recipient.kind, "id": recipient.target_id, "estado": activity.status});
            match self.channel.deliver(&delivery).await {
                Ok(()) => self.audit(account_id, Some(activity.id), None, "recipient.notify", "sent", detail),
                Err(error) => {
                    self.store.recipient_error(recipient.id, &error.to_string())?;
                    self.audit(
                        account_id,
                        Some(activity.id),
                        None,
                        "recipient.notify",
                        "failed",
                        detail,
                    );
                }
            }
        }
        Ok(())
    }

    /// Notifying never fails the use case that ended the request.
    pub(super) async fn tell_recipients(&self, account_id: i64, id: i64) {
        if let Err(error) = self.notify_recipients(account_id, id).await {
            tracing::warn!(%error, id, "engine recipients not notified");
        }
    }
}
