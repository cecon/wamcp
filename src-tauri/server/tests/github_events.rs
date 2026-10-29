//! Which GitHub webhook events reach a GitHub inbox, and as what.
use serde_json::json;
use wamcp_server::domain::github::{comment_target, parse, valid_repo};

fn repository() -> serde_json::Value {
    json!({ "full_name": "cecon/wamcp", "default_branch": "main", "html_url": "https://github.com/cecon/wamcp" })
}

#[test]
fn failed_workflows_go_to_their_pull_request_or_to_the_activity() {
    let run = |conclusion: &str, prs: serde_json::Value| {
        json!({ "action": "completed", "sender": { "login": "maria" }, "repository": repository(),
                "workflow_run": { "name": "CI", "conclusion": conclusion, "head_branch": "fix/login",
                                  "head_sha": "abcdef1234567", "html_url": "https://github.com/cecon/wamcp/actions/runs/9",
                                  "display_title": "Corrige login", "pull_requests": prs } })
    };
    let on_pr = parse("workflow_run", &run("failure", json!([{ "number": 12 }])), None).unwrap();
    assert_eq!(on_pr.thread.source_id, "cecon/wamcp#12");
    assert_eq!(
        on_pr.text,
        "O workflow \"CI\" falhou (failure) em fix/login (abcdef1).\nhttps://github.com/cecon/wamcp/actions/runs/9"
    );
    let on_main = parse("workflow_run", &run("timed_out", json!([])), None).unwrap();
    assert_eq!(on_main.thread.source_id, "cecon/wamcp@atividade");
    assert!(
        parse("workflow_run", &run("success", json!([])), None).is_none(),
        "only failures"
    );
}

#[test]
fn reviews_issues_and_unknown_events() {
    let review = |state: &str, body: &str| {
        json!({ "action": "submitted", "sender": { "login": "joao" }, "repository": repository(),
                "pull_request": { "number": 3, "title": "X" }, "review": { "state": state, "body": body } })
    };
    let approved = parse("pull_request_review", &review("approved", ""), None).unwrap();
    assert_eq!(approved.text, "@joao revisou o PR e aprovou.");
    let changes = parse(
        "pull_request_review",
        &review("changes_requested", "Falta teste."),
        None,
    )
    .unwrap();
    assert_eq!(changes.text, "@joao revisou o PR e pediu mudanças.\n\nFalta teste.");
    assert!(
        parse("pull_request_review", &review("commented", " "), None).is_none(),
        "empty review comment"
    );

    let issue = json!({ "action": "opened", "sender": { "login": "ana" }, "repository": repository(),
                        "issue": { "number": 8, "title": "Erro no login", "body": "Passos…" } });
    let opened = parse("issues", &issue, Some("wamcp-bot")).unwrap();
    assert_eq!(opened.thread.title, "Issue #8: Erro no login");
    assert_eq!(opened.text, "@ana abriu a issue: Erro no login\n\nPassos…");
    assert!(
        parse("issues", &issue, Some("ANA")).is_none(),
        "the channel's own account"
    );
    assert!(parse("star", &issue, None).is_none());

    assert_eq!(comment_target("cecon/wamcp#8"), Some(("cecon/wamcp", 8)));
    assert_eq!(comment_target("cecon/wamcp@atividade"), None);
    assert!(valid_repo("cecon/wamcp") && !valid_repo("cecon") && !valid_repo("a/b/c") && !valid_repo("a b/c"));
}
