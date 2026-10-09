//! Bulk actions on selected conversations (Chatwoot `bulk_actions`): status, snooze, assignee,
//! team, priority and labels, each applied through the regular use case.
use super::helpdesk::HelpdeskService;
use crate::domain::actor::Actor;
use crate::domain::error::{fail, Error, Result};
use serde::Serialize;

#[derive(Debug, Clone, Default)]
pub struct BulkAction {
    pub ids: Vec<i64>,
    pub status: Option<String>,
    pub snoozed_until: Option<i64>,
    pub assignee: Option<Option<i64>>,
    pub team: Option<Option<i64>>,
    pub priority: Option<Option<String>>,
    pub add_labels: Vec<String>,
    pub remove_labels: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct BulkFailure {
    pub id: i64,
    pub error: String,
}

#[derive(Debug, Serialize, Default)]
pub struct BulkResult {
    pub updated: Vec<i64>,
    pub failed: Vec<BulkFailure>,
}

impl BulkAction {
    fn is_empty(&self) -> bool {
        self.status.is_none()
            && self.assignee.is_none()
            && self.team.is_none()
            && self.priority.is_none()
            && self.add_labels.is_empty()
            && self.remove_labels.is_empty()
    }
}

impl HelpdeskService {
    fn apply(&self, actor: &Actor, id: i64, action: &BulkAction) -> Result<()> {
        if let Some(status) = &action.status {
            let until = action.snoozed_until.filter(|_| status == "snoozed");
            self.toggle_status(actor, id, status, until)?;
        }
        if action.assignee.is_some() || action.team.is_some() {
            self.assign(actor, id, action.assignee, action.team)?;
        }
        if let Some(priority) = &action.priority {
            self.set_priority(actor, id, priority.as_deref())?;
        }
        if !action.add_labels.is_empty() || !action.remove_labels.is_empty() {
            let current = self.conversation(actor, id)?.labels;
            let mut labels: Vec<String> = current
                .into_iter()
                .filter(|l| !action.remove_labels.contains(l))
                .collect();
            labels.extend(
                action
                    .add_labels
                    .iter()
                    .filter(|l| !labels.contains(l))
                    .cloned()
                    .collect::<Vec<_>>(),
            );
            self.set_labels(actor, id, &labels)?;
        }
        Ok(())
    }

    /// Applies the same changes to every selected conversation; failures do not stop the others.
    pub fn bulk(&self, actor: &Actor, action: &BulkAction) -> Result<BulkResult> {
        if action.ids.is_empty() || action.ids.len() > 100 || action.is_empty() {
            return fail("Selecione até 100 conversas e ao menos uma alteração");
        }
        let mut result = BulkResult::default();
        for id in &action.ids {
            match self.apply(actor, *id, action) {
                Ok(()) => result.updated.push(*id),
                Err(Error::Helpdesk(e)) => result.failed.push(BulkFailure {
                    id: *id,
                    error: e.message,
                }),
                Err(Error::Internal(_)) => result.failed.push(BulkFailure {
                    id: *id,
                    error: "Falha ao atualizar".into(),
                }),
            }
        }
        Ok(result)
    }
}
