//! What each `github` tool does on the REST API, always on the channel's repository.
use crate::application::helpdesk::HelpdeskService;
use crate::domain::error::{fail, Result};
use crate::domain::github::marked;
use crate::domain::github_tools::{head, run_and_job, segment, tail, valid_login, DIFF_BUDGET, LOG_TAIL, PATCH_LIMIT};
use serde_json::{json, Value};

pub(super) struct Api<'a> {
    pub helpdesk: &'a HelpdeskService,
    pub token: String,
    pub repo: String,
}

fn str_of<'v>(value: &'v Value, key: &str) -> &'v str {
    value[key].as_str().unwrap_or_default()
}

fn logins(list: &Value) -> Vec<&str> {
    list.as_array()
        .map(|people| people.iter().filter_map(|p| p["login"].as_str()).collect())
        .unwrap_or_default()
}

fn strings(list: &Value) -> Vec<String> {
    list.as_array()
        .map(|items| {
            items
                .iter()
                .filter_map(|i| i.as_str().map(str::trim))
                .filter(|i| !i.is_empty())
                .map(String::from)
                .collect()
        })
        .unwrap_or_default()
}

impl Api<'_> {
    async fn call(&self, method: &str, path: &str, body: Option<Value>) -> Result<Value> {
        let path = format!("/repos/{}{path}", self.repo);
        self.helpdesk.github.api(&self.token, method, &path, body).await
    }

    fn forget_on_error(&self, number: u64, kind: &str, outcome: Result<Value>) -> Result<Value> {
        if outcome.is_err() {
            self.helpdesk.forget_echo(&format!("{}#{number}", self.repo), kind);
        }
        outcome
    }

    /// Where the agent's action lands: the conversation of `#number` in this repository.
    fn echo(&self, number: u64, kind: &str) {
        self.helpdesk.expect_echo(&format!("{}#{number}", self.repo), kind);
    }

    pub async fn item(&self, number: u64) -> Result<Value> {
        let issue = self.call("GET", &format!("/issues/{number}"), None).await?;
        let mut item = json!({
            "number": number,
            "title": str_of(&issue, "title"),
            "state": str_of(&issue, "state"),
            "state_reason": issue["state_reason"],
            "author": issue["user"]["login"],
            "body": head(str_of(&issue, "body"), 8_000),
            "labels": issue["labels"].as_array().map(|l| l.iter().map(|l| l["name"].clone()).collect::<Vec<_>>()),
            "assignees": logins(&issue["assignees"]),
            "url": issue["html_url"],
        });
        if issue.get("pull_request").is_some() {
            let pr = self.call("GET", &format!("/pulls/{number}"), None).await?;
            item["pull_request"] = json!({
                "draft": pr["draft"],
                "merged": pr["merged"],
                "mergeable": pr["mergeable"],
                "mergeable_state": pr["mergeable_state"],
                "head": pr["head"]["ref"],
                "base": pr["base"]["ref"],
                "requested_reviewers": logins(&pr["requested_reviewers"]),
            });
            item["checks"] = self.check_runs(str_of(&pr["head"], "sha")).await?;
        }
        Ok(item)
    }

    pub async fn pr_files(&self, number: u64) -> Result<Value> {
        let files = self
            .call("GET", &format!("/pulls/{number}/files?per_page=100"), None)
            .await?;
        let mut budget = DIFF_BUDGET;
        let mut out = Vec::new();
        for file in files.as_array().into_iter().flatten() {
            let patch = head(str_of(file, "patch"), PATCH_LIMIT.min(budget));
            budget = budget.saturating_sub(patch.len());
            out.push(json!({
                "file": file["filename"], "status": file["status"],
                "additions": file["additions"], "deletions": file["deletions"],
                "patch": if budget == 0 { "(diff omitido: limite atingido)".into() } else { patch },
            }));
        }
        Ok(json!({ "files": out }))
    }

    async fn check_runs(&self, sha: &str) -> Result<Value> {
        if sha.is_empty() {
            return Ok(json!([]));
        }
        let found = self
            .call("GET", &format!("/commits/{sha}/check-runs?per_page=100"), None)
            .await?;
        let runs = found["check_runs"].as_array().into_iter().flatten().map(|check| {
            let (run_id, job_id) = run_and_job(str_of(check, "html_url"));
            json!({ "name": check["name"], "status": check["status"], "conclusion": check["conclusion"],
                    "run_id": run_id, "job_id": job_id, "url": check["html_url"] })
        });
        Ok(Value::Array(runs.collect()))
    }

    pub async fn checks(&self, number: u64) -> Result<Value> {
        let pr = self.call("GET", &format!("/pulls/{number}"), None).await?;
        Ok(json!({ "head": pr["head"]["ref"], "checks": self.check_runs(str_of(&pr["head"], "sha")).await? }))
    }

    pub async fn job_log(&self, args: &Value) -> Result<Value> {
        let Some(job) = args["job_id"].as_u64() else {
            return fail("Informe job_id");
        };
        let log = self.helpdesk.github.job_log(&self.token, &self.repo, job).await?;
        Ok(json!({ "job_id": job, "log_tail": tail(&log, LOG_TAIL) }))
    }

    pub async fn review(&self, number: u64, args: &Value) -> Result<Value> {
        let event = str_of(args, "event");
        if !["APPROVE", "REQUEST_CHANGES", "COMMENT"].contains(&event) {
            return fail("event deve ser APPROVE, REQUEST_CHANGES ou COMMENT");
        }
        let body = str_of(args, "body").trim();
        let comments: Vec<Value> = args["comments"]
            .as_array()
            .into_iter()
            .flatten()
            .map(
                |c| json!({ "path": c["path"], "line": c["line"], "side": "RIGHT", "body": marked(str_of(c, "body")) }),
            )
            .collect();
        let mut request = json!({ "event": event, "comments": comments });
        if !body.is_empty() {
            request["body"] = json!(marked(body));
        }
        self.echo(number, "pull_request_review.submitted");
        let review = self.forget_on_error(
            number,
            "pull_request_review.submitted",
            self.call("POST", &format!("/pulls/{number}/reviews"), Some(request))
                .await,
        )?;
        Ok(json!({ "review": review["id"], "state": review["state"] }))
    }

    pub async fn merge(&self, number: u64, args: &Value) -> Result<Value> {
        let method = args["method"].as_str().unwrap_or("merge");
        let mut request = json!({ "merge_method": method });
        if let Some(title) = args["title"].as_str().filter(|t| !t.trim().is_empty()) {
            request["commit_title"] = json!(title);
        }
        self.echo(number, "pull_request.closed");
        let merged = self.forget_on_error(
            number,
            "pull_request.closed",
            self.call("PUT", &format!("/pulls/{number}/merge"), Some(request)).await,
        )?;
        Ok(json!({ "merged": merged["merged"], "sha": merged["sha"], "message": merged["message"] }))
    }

    pub async fn set_state(&self, number: u64, args: &Value) -> Result<Value> {
        let state = str_of(args, "state");
        let verb = match state {
            "closed" => "closed",
            "open" => "reopened",
            _ => return fail("state deve ser open ou closed"),
        };
        let mut request = json!({ "state": state });
        if let Some(reason) = args["reason"].as_str().filter(|_| state == "closed") {
            request["state_reason"] = json!(reason);
        }
        // An issue's echo is `issues.*`, a pull request's `pull_request.*`: expect either.
        self.echo(number, &format!("issues.{verb}"));
        self.echo(number, &format!("pull_request.{verb}"));
        let item = self.call("PATCH", &format!("/issues/{number}"), Some(request)).await;
        // Only one of the two echoes will come.
        let (issue, pr) = (format!("issues.{verb}"), format!("pull_request.{verb}"));
        let unused = match &item {
            Ok(item) if item.get("pull_request").is_some() => vec![issue],
            Ok(_) => vec![pr],
            Err(_) => vec![issue, pr],
        };
        for kind in unused {
            self.helpdesk.forget_echo(&format!("{}#{number}", self.repo), &kind);
        }
        let item = item?;
        Ok(json!({ "number": number, "state": item["state"] }))
    }

    pub async fn people(&self, number: u64, args: &Value, key: &str) -> Result<Value> {
        let people = strings(&args[key]);
        if people.is_empty() || !people.iter().all(|p| valid_login(p)) {
            return fail("Informe logins do GitHub válidos");
        }
        let (path, field) = match key {
            "reviewers" => (format!("/pulls/{number}/requested_reviewers"), "reviewers"),
            _ => (format!("/issues/{number}/assignees"), "assignees"),
        };
        self.call("POST", &path, Some(json!({ field: people }))).await?;
        Ok(json!({ "number": number, key: people }))
    }

    pub async fn labels(&self, number: u64, args: &Value) -> Result<Value> {
        let (add, remove) = (strings(&args["add"]), strings(&args["remove"]));
        if add.is_empty() && remove.is_empty() {
            return fail("Informe labels em add ou remove");
        }
        if !add.is_empty() {
            let path = format!("/issues/{number}/labels");
            self.call("POST", &path, Some(json!({ "labels": add }))).await?;
        }
        for label in &remove {
            let path = format!("/issues/{number}/labels/{}", segment(label));
            self.call("DELETE", &path, None).await?;
        }
        Ok(json!({ "number": number, "added": add, "removed": remove }))
    }

    /// The jobs of a workflow run (a failure on a branch has no PR to read the checks from).
    pub async fn run_jobs(&self, args: &Value) -> Result<Value> {
        let Some(run) = args["run_id"].as_u64() else {
            return fail("Informe run_id");
        };
        let found = self
            .call("GET", &format!("/actions/runs/{run}/jobs?per_page=100"), None)
            .await?;
        let jobs = found["jobs"].as_array().into_iter().flatten().map(|job| {
            let failed: Vec<&Value> = job["steps"]
                .as_array()
                .into_iter()
                .flatten()
                .filter(|step| step["conclusion"] == "failure")
                .map(|step| &step["name"])
                .collect();
            json!({ "name": job["name"], "status": job["status"], "conclusion": job["conclusion"],
                    "job_id": job["id"], "failed_steps": failed })
        });
        Ok(json!({ "run_id": run, "jobs": jobs.collect::<Vec<_>>() }))
    }

    pub async fn rerun(&self, args: &Value) -> Result<Value> {
        let Some(run) = args["run_id"].as_u64() else {
            return fail("Informe run_id");
        };
        self.call("POST", &format!("/actions/runs/{run}/rerun-failed-jobs"), None)
            .await?;
        Ok(json!({ "run_id": run, "rerun": true }))
    }
}
