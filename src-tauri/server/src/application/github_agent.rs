//! The AI agent of a GitHub inbox acting on the repository. While it answers a conversation, a
//! short-lived run token opens the app's `github` tools to its runtime (`/mcp-github`, on this
//! computer only), bound to that inbox's repository and to the pull request or issue of the
//! conversation. What the agent does comes back from GitHub as webhook events: those echoes are
//! kept in the conversation as activity, without waking the agent again.
mod actions;

use super::core::Events;
use super::helpdesk::HelpdeskService;
use crate::domain::actor::Actor;
use crate::domain::error::{fail, fail_with, Result};
use crate::domain::github::{comment_target, GithubEvent};
use crate::domain::model::Inbox;
use parking_lot::Mutex;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Arc;

/// How long an action waits for its echo from GitHub.
const ECHO_MS: i64 = 10 * 60 * 1000;

/// One answer being written on a GitHub conversation.
#[derive(Debug, Clone)]
pub struct GithubRun {
    pub inbox_id: i64,
    pub display_id: i64,
    /// The conversation's `owner/repo#12` or the repository's activity.
    pub source_id: String,
    /// The AI agent answering (its supervisor receives `forward`).
    pub agent_id: Option<i64>,
    /// Set by `forward`: the conversation goes to the human team once the answer is out.
    pub handoff: bool,
}

#[derive(Default)]
pub struct GithubRunState {
    runs: HashMap<String, GithubRun>,
    /// Events the agent's own actions will cause: (`owner/repo#12`, `pull_request.closed`, until).
    echoes: Vec<(String, String, i64)>,
    /// Installation tokens of the GitHub App: installation → (token, valid until).
    pub(crate) tokens: HashMap<i64, (String, i64)>,
    /// Workflows failing on a branch, already reported to the agent: `inbox|workflow|branch`.
    pub(crate) failing: std::collections::HashSet<String>,
}

pub type GithubRuns = Arc<Mutex<GithubRunState>>;

impl HelpdeskService {
    /// Starts a run; the token is the bearer credential of `/mcp-github` until it ends.
    pub fn open_github_run(&self, run: GithubRun) -> String {
        let token = format!("wgh_{}", uuid::Uuid::new_v4().simple());
        self.github_runs.lock().runs.insert(token.clone(), run);
        token
    }

    /// Ends a run and answers what it did.
    pub fn close_github_run(&self, token: &str) -> Option<GithubRun> {
        self.github_runs.lock().runs.remove(token)
    }

    pub fn github_run_open(&self, token: &str) -> bool {
        self.github_runs.lock().runs.contains_key(token)
    }

    fn github_run(&self, token: &str) -> Result<GithubRun> {
        match self.github_runs.lock().runs.get(token) {
            Some(run) => Ok(run.clone()),
            None => fail_with("Execução inválida ou encerrada", 401),
        }
    }

    /// The agent is about to cause `kind` (`issues.closed`, …) on `source_id`.
    fn expect_echo(&self, source_id: &str, kind: &str) {
        let until = self.core.clock.now_ms() + ECHO_MS;
        let mut state = self.github_runs.lock();
        state.echoes.push((source_id.into(), kind.into(), until));
    }

    /// Drops an expected echo (the action failed, or it was the other kind).
    fn forget_echo(&self, source_id: &str, kind: &str) {
        let mut state = self.github_runs.lock();
        if let Some(at) = state.echoes.iter().position(|(s, k, _)| s == source_id && k == kind) {
            state.echoes.remove(at);
        }
    }

    /// Whether the event is the echo of the agent's own action (each echo is used once).
    pub(crate) fn take_github_echo(&self, event: &GithubEvent) -> bool {
        let now = self.core.clock.now_ms();
        let mut state = self.github_runs.lock();
        state.echoes.retain(|(_, _, until)| *until > now);
        let found = state
            .echoes
            .iter()
            .position(|(source, kind, _)| *source == event.thread.source_id && *kind == event.kind);
        found.map(|at| state.echoes.remove(at)).is_some()
    }

    /// Keeps an echo in its conversation as activity: no reopening, no new answer.
    pub(crate) fn note_github_echo(&self, inbox: &Inbox, event: &GithubEvent, events: &mut Events) -> Result<()> {
        let repo = &self.core.repo;
        let Some(contact) = repo.contact_inbox(inbox.id, &event.thread.source_id)? else {
            return Ok(());
        };
        if let Some(conversation) = repo.latest_conversation(contact.id)? {
            self.core.activity(&conversation, event.text.clone(), events)?;
        }
        Ok(())
    }

    /// Runs one tool of the agent's run.
    pub async fn github_tool(&self, token: &str, name: &str, args: &Value) -> Result<Value> {
        let run = self.github_run(token)?;
        let Some(channel) = self.core.repo.github_channel(run.inbox_id)? else {
            return fail("O canal do GitHub não existe mais");
        };
        let api = actions::Api {
            helpdesk: self,
            token: self.github_token(&channel).await?,
            repo: channel.repo,
        };
        let number = || match args["number"]
            .as_u64()
            .or(comment_target(&run.source_id).map(|(_, n)| n))
        {
            Some(n) => Ok(n),
            None => fail("Informe number: esta conversa não é de um PR nem de uma issue"),
        };
        match name {
            "item" => api.item(number()?).await,
            "pr_files" => api.pr_files(number()?).await,
            "checks" => api.checks(number()?).await,
            "job_log" => api.job_log(args).await,
            "review" => api.review(number()?, args).await,
            "merge" => api.merge(number()?, args).await,
            "set_state" => api.set_state(number()?, args).await,
            "assign" => api.people(number()?, args, "assignees").await,
            "request_reviewers" => api.people(number()?, args, "reviewers").await,
            "labels" => api.labels(number()?, args).await,
            "rerun_failed" => api.rerun(args).await,
            "run_jobs" => api.run_jobs(args).await,
            "forward" => self.forward(token, &run, args).await,
            _ => fail(format!("Ferramenta desconhecida: {name}")),
        }
    }

    /// Hands the conversation to the agent's supervisor: a private note for them, the conversation
    /// assigned to them, and (once the answer is out) the human team takes over.
    async fn forward(&self, token: &str, run: &GithubRun, args: &Value) -> Result<Value> {
        let note = args["note"].as_str().map(str::trim).unwrap_or_default();
        if note.is_empty() {
            return fail("Escreva a nota para o responsável");
        }
        let repo = &self.core.repo;
        let agent = match run.agent_id {
            Some(id) => repo.agent(id)?,
            None => None,
        };
        let supervisor = match agent.and_then(|a| a.supervisor_id) {
            Some(id) => repo.agent(id)?,
            None => None,
        };
        let Some((name, user_id)) = supervisor.and_then(|s| Some((s.name, s.user_id?))) else {
            return fail("Você não tem um responsável direto com login no app: marque handoff para o time humano");
        };
        let actor = Actor::Bot { inbox_id: run.inbox_id };
        self.reply(&actor, run.display_id, &format!("Para {name}: {note}"), true)
            .await?;
        self.assign(&actor, run.display_id, Some(Some(user_id)), None)?;
        if let Some(run) = self.github_runs.lock().runs.get_mut(token) {
            run.handoff = true;
        }
        Ok(serde_json::json!({ "forwarded_to": name }))
    }
}
