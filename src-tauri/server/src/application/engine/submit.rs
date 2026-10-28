//! Activities: submitting one, executing it run after run (with retries and limits) and recovering
//! the unfinished ones after a restart.
use super::drive::RunEnd;
use super::EngineService;
use crate::domain::engine::activity::{self as status, reply};
use crate::domain::engine::model::{Activity, ActivityDraft};
use crate::domain::engine::{over_budget, FAILURE_NOTICE, MAX_ATTEMPTS};
use crate::domain::error::{fail, Result};
use serde_json::json;

/// A request for an AI agent: from a person, a contact's conversation or an event.
#[derive(Debug, Clone, Default)]
pub struct Submission {
    pub account_id: i64,
    pub agent_id: i64,
    pub request: String,
    pub requester: String,
    pub conversation_id: Option<i64>,
    pub idempotency_key: Option<String>,
    pub priority: i64,
    pub deadline: Option<String>,
}

impl EngineService {
    /// Creates the activity (or returns the one with the same idempotency key) without running it.
    pub fn submit(&self, s: &Submission) -> Result<(Activity, bool)> {
        let request = s.request.trim();
        if request.is_empty() || request.chars().count() > 4000 {
            return fail("O pedido precisa ter entre 1 e 4000 caracteres");
        }
        let agent = self.agent(s.account_id, s.agent_id)?;
        if !self.store.policy(s.account_id, agent.id)?.enabled {
            return fail("O motor está desligado para este agente");
        }
        let draft = ActivityDraft {
            account_id: s.account_id,
            requester: s.requester.clone(),
            agent_id: agent.id,
            parent_id: None,
            priority: s.priority,
            deadline: s.deadline.clone(),
            request: request.into(),
            idempotency_key: s.idempotency_key.clone(),
            conversation_id: s.conversation_id,
            correlation_id: uuid::Uuid::new_v4().simple().to_string(),
        };
        let (activity, created) = self.store.create_activity(&draft)?;
        let outcome = if created { "created" } else { "duplicate" };
        self.audit(
            s.account_id,
            Some(activity.id),
            Some(agent.id),
            "activity.submit",
            outcome,
            json!({}),
        );
        Ok((activity, created))
    }

    /// Submits and executes in the background; returns at once.
    pub fn start(&self, s: &Submission) -> Result<Activity> {
        let (activity, created) = self.submit(s)?;
        if created {
            self.spawn_execute(activity.account_id, activity.id);
        }
        Ok(activity)
    }

    pub(super) fn spawn_execute(&self, account_id: i64, id: i64) {
        let engine = self.clone();
        tokio::spawn(async move {
            if let Err(error) = engine.execute(account_id, id).await {
                tracing::warn!(%error, id, "engine activity failed to execute");
            }
        });
    }

    /// Runs the activity until it is final or waits for approval. Only one driver per activity.
    pub async fn execute(&self, account_id: i64, id: i64) -> Result<Activity> {
        if !self.active.lock().insert(id) {
            return self.wait_final(account_id, id).await;
        }
        let result = self.drive_activity(account_id, id).await;
        self.active.lock().remove(&id);
        result?;
        self.load(account_id, id)
    }

    async fn drive_activity(&self, account_id: i64, id: i64) -> Result<()> {
        loop {
            let activity = self.load(account_id, id)?;
            if status::is_final(&activity.status) || activity.status == status::WAITING_APPROVAL {
                return Ok(());
            }
            if activity.status == status::QUEUED
                && !self.store.move_activity(id, status::QUEUED, status::RUNNING, None)?
            {
                continue;
            }
            let agent = self.agent(account_id, activity.agent_id)?;
            let policy = self.store.policy(account_id, agent.id)?;
            let month = chrono::Utc::now().format("%Y-%m-01T00:00:00").to_string();
            if over_budget(
                self.store.tokens_since(account_id, agent.id, &month)?,
                policy.monthly_token_budget,
            ) {
                return self
                    .fail_activity(&activity, "Orçamento mensal de tokens do agente esgotado")
                    .await;
            }
            let attempts = self.store.add_attempt(id)?;
            let permit = self.slot(agent.id, policy.max_concurrency).acquire_owned().await;
            let end = self.run_once(&activity, &agent, &policy).await;
            drop(permit);
            match end {
                RunEnd::Done => return Ok(()),
                RunEnd::Failed(error) if attempts >= MAX_ATTEMPTS => {
                    return self.fail_activity(&activity, &error).await;
                }
                RunEnd::Failed(error) => {
                    self.audit(
                        account_id,
                        Some(id),
                        Some(agent.id),
                        "activity.retry",
                        "scheduled",
                        json!({"erro": error}),
                    );
                }
            }
        }
    }

    /// Waits for another driver of the same activity to finish (a repeated delegation, recovery).
    async fn wait_final(&self, account_id: i64, id: i64) -> Result<Activity> {
        loop {
            let activity = self.load(account_id, id)?;
            let busy = self.active.lock().contains(&id);
            if !busy || status::is_final(&activity.status) || activity.status == status::WAITING_APPROVAL {
                return Ok(activity);
            }
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        }
    }

    pub(super) fn load(&self, account_id: i64, id: i64) -> Result<Activity> {
        match self.store.activity(account_id, id)? {
            Some(activity) => Ok(activity),
            None => fail("Atividade não encontrada"),
        }
    }

    /// Fails the activity and tells the requester with a fixed notice (once), never an invented result.
    pub(super) async fn fail_activity(&self, activity: &Activity, error: &str) -> Result<()> {
        let current = self.load(activity.account_id, activity.id)?;
        if status::is_final(&current.status)
            || !self
                .store
                .move_activity(activity.id, &current.status, status::FAILED, Some(error))?
        {
            return Ok(());
        }
        self.audit(
            activity.account_id,
            Some(activity.id),
            Some(activity.agent_id),
            "activity.fail",
            "failed",
            json!({"erro": error}),
        );
        if let (None, Some(conversation)) = (activity.parent_id, activity.conversation_id) {
            if current.reply_state.is_none() && self.channel.reply(conversation, FAILURE_NOTICE).await.is_ok() {
                self.store.set_reply_state(activity.id, Some(reply::SENT))?;
            }
        }
        Ok(())
    }

    /// Startup: runs that were going are interrupted; root activities left unfinished run again,
    /// except one whose answer may already have gone out (it fails for a person to check).
    pub async fn recover(&self) -> Result<usize> {
        let interrupted = self.store.interrupt_runs()?;
        let roots = self.store.unfinished_roots()?;
        for activity in &roots {
            if activity.reply_state.as_deref() == Some(reply::SENDING) {
                let message =
                    "O app reiniciou enquanto a resposta era enviada; verifique se ela saiu antes de reenviar";
                self.store
                    .move_activity(activity.id, &activity.status, status::FAILED, Some(message))?;
                self.audit(
                    activity.account_id,
                    Some(activity.id),
                    Some(activity.agent_id),
                    "activity.recover",
                    "needs_check",
                    json!({}),
                );
                continue;
            }
            self.audit(
                activity.account_id,
                Some(activity.id),
                Some(activity.agent_id),
                "activity.recover",
                "resumed",
                json!({"runs_interrompidas": interrupted}),
            );
            self.spawn_execute(activity.account_id, activity.id);
        }
        Ok(roots.len())
    }
}
