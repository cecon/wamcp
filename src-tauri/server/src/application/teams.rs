//! Teams and inbox administration (membership, settings, working hours).
use super::accounts::AccountService;
use crate::domain::actor::Actor;
use crate::domain::error::{fail_with, HelpdeskError, Result};
use crate::domain::helpdesk::require_admin;
use crate::domain::model::{DaySchedule, Inbox, InboxChanges, Team, TeamFields, User, WorkingHour};
use crate::domain::schedule::{validate_schedule, validate_timezone};

impl AccountService {
    fn find_team(&self, id: i64) -> Result<Team> {
        self.core
            .repo
            .team(id)?
            .ok_or_else(|| HelpdeskError::not_found("Time não encontrado").into())
    }

    fn require_users(&self, ids: &[i64]) -> Result<()> {
        ids.iter().try_for_each(|id| self.find_user(*id).map(|_| ()))
    }

    pub fn teams(&self) -> Result<Vec<Team>> {
        self.core.repo.teams()
    }

    pub fn create_team(&self, actor: &Actor, team: &TeamFields) -> Result<Team> {
        require_admin(actor)?;
        let name = team.name.as_deref().unwrap_or_default();
        if self.core.repo.team_by_name(name, 0)?.is_some() {
            return fail_with("Já existe um time com esse nome", 409);
        }
        self.core.repo.create_team(team)
    }

    pub fn update_team(&self, actor: &Actor, id: i64, fields: &TeamFields) -> Result<Team> {
        require_admin(actor)?;
        self.find_team(id)?;
        if let Some(name) = fields.name.as_deref().filter(|n| !n.is_empty()) {
            if self.core.repo.team_by_name(name, id)?.is_some() {
                return fail_with("Já existe um time com esse nome", 409);
            }
        }
        self.core.repo.update_team(id, fields)
    }

    pub fn delete_team(&self, actor: &Actor, id: i64) -> Result<()> {
        require_admin(actor)?;
        self.find_team(id)?;
        self.core.repo.delete_team(id)
    }

    pub fn team_members(&self, id: i64) -> Result<Vec<User>> {
        self.find_team(id)?;
        self.core.repo.team_members(id)
    }

    pub fn change_team_members(&self, actor: &Actor, id: i64, user_ids: &[i64], add: bool) -> Result<Vec<User>> {
        require_admin(actor)?;
        self.find_team(id)?;
        self.require_users(user_ids)?;
        if add {
            self.core.repo.add_team_members(id, user_ids)?;
        } else {
            self.core.repo.remove_team_members(id, user_ids)?;
        }
        self.core.repo.team_members(id)
    }

    pub fn inboxes(&self, actor: &Actor) -> Result<Vec<Inbox>> {
        self.core.repo.sync_inboxes()?;
        match self.core.visible_inbox_ids(actor)? {
            None => self.core.repo.inboxes(None),
            Some(ids) => self.core.repo.inboxes(Some(&ids)),
        }
    }

    pub fn inbox(&self, actor: &Actor, id: i64) -> Result<Inbox> {
        let inbox = self.core.inbox(id)?;
        if !actor.is_admin() && !self.core.member_inbox_ids(actor)?.contains(&id) {
            return Err(HelpdeskError::not_found("Caixa de entrada não encontrada").into());
        }
        Ok(inbox)
    }

    pub fn update_inbox(&self, actor: &Actor, id: i64, changes: &InboxChanges) -> Result<Inbox> {
        require_admin(actor)?;
        self.core.inbox(id)?;
        if let Some(timezone) = changes.timezone.as_deref().filter(|t| !t.is_empty()) {
            validate_timezone(timezone)?;
        }
        self.core.repo.update_inbox(id, changes)
    }

    pub fn working_hours(&self, actor: &Actor, id: i64) -> Result<Vec<WorkingHour>> {
        require_admin(actor)?;
        self.core.inbox(id)?;
        self.core.repo.working_hours(id)
    }

    pub fn set_working_hours(&self, actor: &Actor, id: i64, days: &[DaySchedule]) -> Result<Vec<WorkingHour>> {
        require_admin(actor)?;
        self.core.inbox(id)?;
        validate_schedule(days)?;
        self.core.repo.set_working_hours(id, days)?;
        self.core.repo.working_hours(id)
    }

    pub fn inbox_members(&self, actor: &Actor, id: i64) -> Result<Vec<User>> {
        require_admin(actor)?;
        self.core.inbox(id)?;
        self.core.repo.inbox_members(id)
    }

    pub fn change_inbox_members(&self, actor: &Actor, id: i64, user_ids: &[i64], add: bool) -> Result<Vec<User>> {
        require_admin(actor)?;
        self.core.inbox(id)?;
        self.require_users(user_ids)?;
        if add {
            self.core.repo.add_inbox_members(id, user_ids)?;
        } else {
            self.core.repo.remove_inbox_members(id, user_ids)?;
        }
        self.core.repo.inbox_members(id)
    }
}
