//! Inbox-level automatic messages: greeting on new conversations, out-of-office outside working
//! hours (on new or contact-reopened conversations), the CSAT survey on resolution and its thank-you.
use super::event_bus::Envelope;
use super::helpdesk::HelpdeskService;
use crate::domain::actor::Actor;
use crate::domain::csat::{CSAT_SURVEY, CSAT_THANKS};
use crate::domain::model::{Conversation, ConversationChanges, ReportingEvent};
use crate::domain::schedule::is_open;

#[derive(Clone)]
pub struct AutoReplyService {
    pub helpdesk: HelpdeskService,
}

impl AutoReplyService {
    async fn send(&self, kind: &str, name: &str, display_id: i64, content: &str) {
        let actor = Actor::system(kind, name);
        let _ = self.helpdesk.reply(&actor, display_id, content, false).await;
    }

    pub async fn on_event(&self, envelope: Envelope) {
        let core = &self.helpdesk.core;
        let Ok(data) = serde_json::from_value::<Conversation>(envelope.data.clone()) else {
            if envelope.event == "csat.created" {
                self.thank(&envelope).await;
            }
            return;
        };
        let reopened = envelope.event == "conversation.status_changed" && envelope.performer.is("contact");
        if envelope.event == "conversation.created" || reopened {
            if data.status != "open" && data.status != "pending" {
                return;
            }
            let Ok(inbox) = core.inbox(data.inbox_id) else {
                return;
            };
            if envelope.event == "conversation.created" && inbox.greeting_enabled != 0 {
                if let Some(greeting) = inbox.greeting_message.as_deref().filter(|g| !g.is_empty()) {
                    self.send("greeting", "Saudação", data.display_id, greeting).await;
                }
            }
            if let Some(away) = inbox.out_of_office_message.as_deref().filter(|m| !m.is_empty()) {
                let schedule = core.repo.working_hours(inbox.id).unwrap_or_default();
                if !is_open(&inbox, &schedule, core.now()) {
                    self.send("out_of_office", "Fora do horário", data.display_id, away)
                        .await;
                }
            }
        } else if envelope.event == "conversation.status_changed" && data.status == "resolved" {
            let Ok(inbox) = core.inbox(data.inbox_id) else {
                return;
            };
            if inbox.csat_survey_enabled == 0 || data.csat_requested_at.is_some_and(|at| at != 0) {
                return;
            }
            let changes = ConversationChanges {
                csat_requested_at: Some(Some(core.now())),
                ..Default::default()
            };
            if core.update(data.id, changes).is_ok() {
                let sent = ReportingEvent {
                    name: "csat_sent",
                    value: 0,
                    user_id: data.assignee_id,
                    inbox_id: data.inbox_id,
                    conversation_id: data.id,
                    created_at: core.now(),
                };
                let _ = core.repo.record_event(&sent);
                let survey = inbox.csat_survey_message.as_deref().filter(|m| !m.trim().is_empty());
                self.send(
                    "csat",
                    "Pesquisa de satisfação",
                    data.display_id,
                    survey.unwrap_or(CSAT_SURVEY),
                )
                .await;
            }
        }
    }

    async fn thank(&self, envelope: &Envelope) {
        let Some(id) = envelope.data["conversation_id"].as_i64() else {
            return;
        };
        if let Ok(Some(conversation)) = self.helpdesk.core.repo.conversation_by_id(id) {
            self.send("csat", "Pesquisa de satisfação", conversation.display_id, CSAT_THANKS)
                .await;
        }
    }
}
