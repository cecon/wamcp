//! Every channel's incoming messages enter the helpdesk here: the routing rule picks the
//! conversation (new, reused or reopened), the channel stores its own message, and the
//! conversation is touched and auto-assigned. The channel only finds the contact and the route.
use super::core::Events;
use super::helpdesk::HelpdeskService;
use crate::domain::error::Result;
use crate::domain::helpdesk::{initial_status, Route};
use crate::domain::model::{ContactInbox, Conversation, ConversationChanges as Changes, Inbox, Message};

/// A message that arrived on a channel, already tied to its contact.
pub(crate) struct Incoming<'a> {
    pub inbox: &'a Inbox,
    pub contact_inbox: &'a ContactInbox,
    /// The contact's latest conversation in the inbox.
    pub latest: Option<Conversation>,
    pub route: Route,
    pub at: i64,
    /// A contact's message that waits for the team (not an echo of ours, not in a muted conversation).
    pub awaits_team: bool,
}

impl HelpdeskService {
    /// Routes `incoming` to its conversation and stores it with `store`. Returns `None` when the
    /// route ignores it or `store` keeps nothing (a duplicate).
    pub(crate) fn receive<F>(&self, incoming: Incoming<'_>, events: &mut Events, store: F) -> Result<Option<Message>>
    where
        F: FnOnce(&Conversation, &mut Events) -> Result<Option<Message>>,
    {
        let Some(conversation) = self.conversation_for(&incoming, events)? else {
            return Ok(None);
        };
        let message = store(&conversation, events)?;
        let mut changes = Changes {
            last_activity_at: Some(conversation.last_activity_at.max(incoming.at)),
            ..Default::default()
        };
        if incoming.awaits_team {
            changes.waiting_since = Some(Some(conversation.waiting_since.unwrap_or(incoming.at)));
        }
        let updated = self.core.update(conversation.id, changes)?;
        if incoming.awaits_team {
            self.core.auto_assign(updated, events)?;
        }
        Ok(message)
    }

    fn conversation_for(&self, incoming: &Incoming<'_>, events: &mut Events) -> Result<Option<Conversation>> {
        let (core, inbox) = (&self.core, incoming.inbox);
        let legacy_bot = inbox.agent_bot_enabled != 0 || inbox.agent_bot_id.is_some();
        let status = initial_status(inbox.ai_agent_id.is_some(), legacy_bot);
        let conversation = match (incoming.route, incoming.latest.clone()) {
            (Route::Ignore, _) => return Ok(None),
            (Route::Create, _) | (Route::Reuse { .. }, None) => {
                let created = core
                    .repo
                    .create_conversation(inbox.id, incoming.contact_inbox, status, incoming.at)?;
                events.push("conversation.created", &created);
                created
            }
            (Route::Reuse { reopen: true }, Some(latest)) => {
                let changes = Changes {
                    status: Some(status.into()),
                    snoozed_until: Some(None),
                    csat_requested_at: Some(None),
                    ..Default::default()
                };
                let reopened = core.update(latest.id, changes)?;
                events.push("conversation.status_changed", &reopened);
                reopened
            }
            (Route::Reuse { reopen: false }, Some(latest)) => latest,
        };
        Ok(Some(conversation))
    }
}
