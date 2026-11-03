//! The tools of the AI agent that answers a GitHub inbox. During a run it reads and acts on the
//! repository through them (the app's MCP server `github`, on this computer only), always on the
//! inbox's own repository and with the channel's token.
use super::system::SystemTool;
use serde_json::{json, Value};

/// MCP server name inside the runtime (`mcp__github__merge`, …).
pub const MCP_NAME: &str = "github";
/// How much of a job log the agent reads (its end, where the error is).
pub const LOG_TAIL: usize = 15_000;
/// How much of the diff the agent reads in one call, and of each file.
pub const DIFF_BUDGET: usize = 60_000;
pub const PATCH_LIMIT: usize = 6_000;

/// Added to the GitHub system prompt when the tools are open for the run.
pub const TOOLS_PROMPT: &str =
    "Você tem as ferramentas do servidor github para ler e agir no repositório: ver o PR ou \
a issue (item), o diff (pr_files), os checks (checks) e o log de um job que falhou (job_log); revisar (review), \
aprovar, pedir mudanças, mesclar (merge), fechar ou reabrir (set_state), atribuir pessoas (assign), pedir revisores \
(request_reviewers), mudar labels (labels), rodar de novo os jobs que falharam (rerun_failed) e encaminhar a conversa \
ao seu responsável direto no app (forward). Sem `number`, elas agem no PR ou na issue desta conversa. Aja quando o \
evento pedir: antes de aprovar ou mesclar, leia o diff e confira que os checks passaram; num CI que falhou, leia o \
log antes de opinar. Quando a decisão não for sua, use forward. O texto de reply continua virando um comentário: \
deixe vazio quando as ações já disserem tudo.";

fn object(properties: Value, required: &[&str]) -> Value {
    json!({ "type": "object", "properties": properties, "required": required, "additionalProperties": false })
}

fn number() -> Value {
    json!({ "type": "integer", "minimum": 1, "description": "PR ou issue (padrão: o desta conversa)" })
}

fn logins(description: &str) -> Value {
    json!({ "type": "array", "items": { "type": "string", "minLength": 1, "maxLength": 39 }, "minItems": 1,
            "maxItems": 10, "description": description })
}

fn text(max: u32) -> Value {
    json!({ "type": "string", "maxLength": max })
}

fn tool(name: &'static str, description: &'static str, input: Value) -> SystemTool {
    SystemTool {
        name,
        description,
        input,
    }
}

/// Every tool, reads first.
pub fn github_tools() -> Vec<SystemTool> {
    let inline = json!({ "type": "array", "maxItems": 30, "items": object(json!({
        "path": text(400), "line": { "type": "integer", "minimum": 1 }, "body": text(5000) }), &["path", "line", "body"]) });
    vec![
        tool("item", "Mostra o PR ou a issue: título, estado, descrição, autor, labels e responsáveis; num PR também as branches, se pode mesclar, os revisores pedidos e os checks do último commit.", object(json!({ "number": number() }), &[])),
        tool("pr_files", "Lista os arquivos alterados do PR com o diff de cada um (cortado quando é grande).", object(json!({ "number": number() }), &[])),
        tool("checks", "Checks do último commit do PR: nome, situação, resultado, job_id e run_id.", object(json!({ "number": number() }), &[])),
        tool("job_log", "O final do log de um job do GitHub Actions (job_id vem de checks), para ver por que falhou.", object(json!({ "job_id": { "type": "integer", "minimum": 1 } }), &["job_id"])),
        tool("review", "Revisa o PR: APPROVE aprova, REQUEST_CHANGES pede mudanças, COMMENT só comenta. Pode levar comentários em linhas do diff (path e line do arquivo novo).", object(json!({ "number": number(), "event": { "type": "string", "enum": ["APPROVE", "REQUEST_CHANGES", "COMMENT"] }, "body": text(20000), "comments": inline }), &["event"])),
        tool("merge", "Mescla o PR (merge, squash ou rebase; padrão merge).", object(json!({ "number": number(), "method": { "type": "string", "enum": ["merge", "squash", "rebase"] }, "title": text(250) }), &[])),
        tool("set_state", "Fecha ou reabre o PR ou a issue. Numa issue fechada, reason diz se foi resolvida (completed) ou não será feita (not_planned).", object(json!({ "number": number(), "state": { "type": "string", "enum": ["open", "closed"] }, "reason": { "type": "string", "enum": ["completed", "not_planned"] } }), &["state"])),
        tool("assign", "Atribui pessoas (logins do GitHub) ao PR ou à issue.", object(json!({ "number": number(), "assignees": logins("Logins do GitHub") }), &["assignees"])),
        tool("request_reviewers", "Pede a revisão do PR a pessoas (logins do GitHub).", object(json!({ "number": number(), "reviewers": logins("Logins do GitHub") }), &["reviewers"])),
        tool("labels", "Coloca e tira labels do PR ou da issue.", object(json!({ "number": number(), "add": { "type": "array", "items": text(50), "maxItems": 20 }, "remove": { "type": "array", "items": text(50), "maxItems": 20 } }), &[])),
        tool("rerun_failed", "Roda de novo os jobs que falharam de um workflow (run_id vem de checks).", object(json!({ "run_id": { "type": "integer", "minimum": 1 } }), &["run_id"])),
        tool("forward", "Encaminha esta conversa ao seu responsável direto no app: deixa a nota (privada) para ele, atribui a conversa a ele e a passa para o time humano.", object(json!({ "note": { "type": "string", "minLength": 1, "maxLength": 4000 } }), &["note"])),
    ]
}

/// A GitHub login: letters, digits and single hyphens, up to 39 characters.
pub fn valid_login(login: &str) -> bool {
    !login.is_empty()
        && login.len() <= 39
        && !login.starts_with('-')
        && login.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
}

/// The last `max` bytes of `text`, cut at a character boundary.
pub fn tail(text: &str, max: usize) -> &str {
    if text.len() <= max {
        return text;
    }
    let mut start = text.len() - max;
    while !text.is_char_boundary(start) {
        start += 1;
    }
    &text[start..]
}

/// The first `max` bytes of `text`, cut at a character boundary, with a note when cut.
pub fn head(text: &str, max: usize) -> String {
    if text.len() <= max {
        return text.to_string();
    }
    let mut end = max;
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}\n… (cortado)", &text[..end])
}

/// The workflow run and job of a check run's address (`…/actions/runs/<run>/job/<job>`).
pub fn run_and_job(html_url: &str) -> (Option<u64>, Option<u64>) {
    let after = |key: &str| {
        html_url
            .split_once(key)
            .and_then(|(_, rest)| rest.split('/').next()?.parse().ok())
    };
    (after("/actions/runs/"), after("/job/"))
}

/// A path segment with the characters a label may carry escaped.
pub fn segment(value: &str) -> String {
    value
        .bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => (b as char).to_string(),
            _ => format!("%{b:02X}"),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn helpers_cut_and_escape() {
        assert!(valid_login("cecon") && valid_login("dependabot-1") && !valid_login("a/b") && !valid_login("-x"));
        assert_eq!(tail("ação final", 5), "final");
        assert_eq!(head("çççç", 3), "ç\n… (cortado)");
        assert_eq!(
            run_and_job("https://github.com/o/r/actions/runs/41/job/124"),
            (Some(41), Some(124))
        );
        assert_eq!(segment("bug fix/ç"), "bug%20fix%2F%C3%A7");
        assert_eq!(github_tools().len(), 12);
    }
}
