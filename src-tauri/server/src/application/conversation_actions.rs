//! Conversation lifecycle actions: status, assignment, labels and priority.
use super::helpdesk::HelpdeskService;
use crate::domain::actor::Actor;
use crate::domain::error::{fail, fail_with, Result};
use crate::domain::helpdesk::{
    assignment_activity, labels_activity, normalize_label_title, status_activity, team_activity,
    validate_status_change, PRIORITIES,
};
use crate::domain::model::{Conversation, ConversationChanges as Changes};

impl HelpdeskService {
    pub fn toggle_status(&self, actor: &Actor, display_id: i64, status: &str, snoozed_until: Option<i64>) -> Result<Conversation> {
        let conversation = self.core.load(Some(actor), display_id)?;
        validate_status_change(status, snoozed_until, self.core.now())?;
        if conversation.status == status && status != "snoozed" {
            return Ok(conversation);
        }
        self.core.commit(Some(actor), |events| {
            let mut updated = self.core.update(
                conversation.id,
                Changes {
                    status: Some(status.into()),
                    snoozed_until: Some(snoozed_until.filter(|_| status == "snoozed")),
                    ..Default::default()
                },
            )?;
            self.core.activity(&updated, status_activity(actor.name().as_deref(), status), events)?;
            events.push("conversation.status_changed", &updated);
            if conversation.status == "pending" && status == "open" {
                events.push("conversation.bot_handoff", &updated);
            }
            if status == "open" {
                updated = self.core.auto_assign(updated, events)?;
            }
            Ok(updated)
        })
    }

    /// `None` leaves the field untouched; `Some(None)` removes the assignee or team.
    pub fn assign(&self, actor: &Actor, display_id: i64, assignee: Option<Option<i64>>, team: Option<Option<i64>>) -> Result<Conversation> {
        let conversation = self.core.load(Some(actor), display_id)?;
        let (core, name) = (&self.core, actor.name());
        core.commit(Some(actor), |events| {
            let mut updated = conversation.clone();
            if let Some(team_id) = team.filter(|t| *t != conversation.team_id) {
                if let Some(id) = team_id {
                    if core.repo.team(id)?.is_none() {
                        return fail_with("Time não encontrado", 404);
                    }
                }
                updated = core.update(conversation.id, Changes { team_id: Some(team_id), ..Default::default() })?;
                core.activity(&updated, team_activity(name.as_deref(), updated.team_name.as_deref()), events)?;
                events.push("team.changed", &updated);
            }
            match assignee {
                Some(assignee_id) if assignee_id != conversation.assignee_id => {
                    if let Some(id) = assignee_id {
                        self.require_assignable(id, conversation.inbox_id)?;
                        core.repo.add_participant(conversation.id, id)?;
                    }
                    updated = core.update(conversation.id, Changes { assignee_id: Some(assignee_id), ..Default::default() })?;
                    let assignee_name = updated.assignee_name.clone();
                    core.activity(&updated, assignment_activity(name.as_deref(), assignee_name.as_deref()), events)?;
                    events.push("assignee.changed", &updated);
                }
                None if matches!(team, Some(Some(_))) => updated = core.auto_assign(updated, events)?,
                _ => {}
            }
            Ok(updated)
        })
    }

    fn require_assignable(&self, user_id: i64, inbox_id: i64) -> Result<()> {
        let repo = &self.core.repo;
        let assignee = repo.user(user_id)?;
        let allowed = match &assignee {
            Some(user) if user.is_active() => {
                user.role == "administrator" || repo.member_inbox_ids(user.id)?.contains(&inbox_id)
            }
            _ => false,
        };
        if allowed {
            Ok(())
        } else {
            fail_with("Agente sem acesso a esta caixa de entrada", 422)
        }
    }

    /// Replaces the conversation labels; every title must be an existing label.
    pub fn set_labels(&self, actor: &Actor, display_id: i64, titles: &[String]) -> Result<Conversation> {
        let conversation = self.core.load(Some(actor), display_id)?;
        let mut wanted: Vec<String> = Vec::new();
        for title in titles {
            let slug = normalize_label_title(title)?;
            if !wanted.contains(&slug) {
                wanted.push(slug);
            }
        }
        let labels = if wanted.is_empty() { Vec::new() } else { self.core.repo.labels_by_titles(&wanted)? };
        let missing: Vec<&str> = wanted
            .iter()
            .filter(|t| !labels.iter().any(|l| l.title.to_lowercase() == **t))
            .map(String::as_str)
            .collect();
        if !missing.is_empty() {
            return fail_with(format!("Etiqueta inexistente: {}", missing.join(", ")), 422);
        }
        let next: Vec<String> = labels.iter().map(|l| l.title.clone()).collect();
        let added: Vec<String> = next.iter().filter(|t| !conversation.labels.contains(t)).cloned().collect();
        let removed: Vec<String> = conversation.labels.iter().filter(|t| !next.contains(t)).cloned().collect();
        if added.is_empty() && removed.is_empty() {
            return Ok(conversation);
        }
        let ids: Vec<i64> = labels.iter().map(|l| l.id).collect();
        self.core.commit(Some(actor), |events| {
            let updated = self.core.repo.set_conversation_labels(conversation.id, &ids)?;
            self.core.activity(&updated, labels_activity(actor.name().as_deref(), &added, &removed), events)?;
            events.push("conversation.updated", &updated);
            Ok(updated)
        })
    }

    pub fn set_priority(&self, actor: &Actor, display_id: i64, priority: Option<&str>) -> Result<Conversation> {
        let conversation = self.core.load(Some(actor), display_id)?;
        if priority.is_some_and(|p| !PRIORITIES.contains(&p)) {
            return fail("Prioridade inválida");
        }
        if conversation.priority.as_deref() == priority {
            return Ok(conversation);
        }
        self.core.commit(Some(actor), |events| {
            let changes = Changes { priority: Some(priority.map(String::from)), ..Default::default() };
            let updated = self.core.update(conversation.id, changes)?;
            events.push("conversation.updated", &updated);
            Ok(updated)
        })
    }

}
