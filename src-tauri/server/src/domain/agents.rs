//! Agent roster rules: people and AI agents share the same roles (from their profile). Coordinators
//! never execute (they only delegate), so they hold no skills; credentials are for AI agents that
//! execute, whose tools use them on the server. People are never run by a runtime.
use super::error::{fail, Result};
use super::model::{RosterAgentDraft, Skill};

pub const KINDS: [&str; 2] = ["human", "ai"];
pub const ROLES: [&str; 4] = ["coordinator", "operator", "dev_support", "qa"];
/// Agentic runtimes an AI agent may use (see docs/agents-plan.md). OpenCode runs any provider's
/// model (`provedor/modelo`, OpenRouter included) and is the agentic engine's runtime.
pub const RUNTIMES: [&str; 3] = ["claude_cli", "codex_cli", "opencode"];
pub const CREDENTIAL_KINDS: [&str; 4] = ["api_key", "bearer", "basic", "secret"];

/// Whether an agent with this role executes tasks (and so may hold skills); "" means no role.
pub fn executes(role: &str) -> bool {
    ROLES.contains(&role) && role != "coordinator"
}

/// Credentials are used by an AI agent's tools on the server, so only AI agents that execute hold them.
pub fn holds_credentials(kind: &str, role: &str) -> bool {
    kind == "ai" && executes(role)
}

/// A WhatsApp number or JID as a user JID (`5511999999999@s.whatsapp.net`).
pub fn whatsapp_jid(input: &str) -> Option<String> {
    let number = input.split('@').next().unwrap_or_default();
    let digits: String = number.chars().filter(char::is_ascii_digit).collect();
    (10..=15)
        .contains(&digits.len())
        .then(|| format!("{digits}@s.whatsapp.net"))
}

/// Checks kind, role and the fields that only make sense for one kind.
pub fn validate_agent(agent: &RosterAgentDraft) -> Result<()> {
    if !KINDS.contains(&agent.kind.as_str()) {
        return fail("Tipo de agente inválido");
    }
    let role_ok = ROLES.contains(&agent.role.as_str()) || (agent.kind == "human" && agent.role.is_empty());
    if !role_ok {
        return fail("Função inválida");
    }
    if agent.kind == "human" {
        if agent.runtime.is_some() || agent.model.is_some() || agent.instructions.is_some() {
            return fail("Agentes humanos não têm runtime, modelo nem instruções");
        }
        if agent.whatsapp_jid.is_none() && agent.user_id.is_none() {
            return fail("Informe o WhatsApp ou o login do agente humano");
        }
        return Ok(());
    }
    if agent.user_id.is_some() || agent.whatsapp_jid.is_some() {
        return fail("Agentes de IA não têm login nem WhatsApp");
    }
    match agent.runtime.as_deref() {
        Some(runtime) if RUNTIMES.contains(&runtime) => Ok(()),
        _ => fail("Escolha o runtime do agente de IA"),
    }
}

/// Skills belong to agents that execute; credentials to AI agents that execute.
pub fn check_capabilities(agent: &RosterAgentDraft, skills: usize, credentials: i64) -> Result<()> {
    if skills > 0 && !executes(&agent.role) {
        return fail(
            "Coordenadores e agentes sem função não executam tarefas: remova as skills ou escolha outra função",
        );
    }
    if credentials > 0 && !holds_credentials(&agent.kind, &agent.role) {
        return fail("Credenciais são só para agentes de IA que executam: remova-as ou escolha outra função");
    }
    Ok(())
}

pub fn validate_credential_name(name: &str) -> Result<()> {
    let ok =
        !name.is_empty() && name.len() <= 60 && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-');
    if ok {
        Ok(())
    } else {
        fail("Nome da credencial: letras, números, _ ou - (até 60)")
    }
}

/// Tool names: MCP-style identifiers, optionally with a `*` suffix (`conversation_*`).
pub fn validate_tools(tools: &[String]) -> Result<()> {
    let valid = |t: &String| {
        !t.is_empty()
            && t.len() <= 80
            && t.trim_end_matches('*')
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    };
    if tools.iter().all(valid) {
        Ok(())
    } else {
        fail("Ferramentas: use nomes como reply_conversation ou conversation_*")
    }
}

fn unquote(value: &str) -> String {
    value.trim().trim_matches(|c| c == '"' || c == '\'').trim().to_string()
}

/// Reads a Claude Code style `SKILL.md`: a `---` front matter with `name`, `description` and
/// optional `allowed-tools` (comma separated or a `- item` list), followed by the instructions.
pub fn parse_skill_md(text: &str) -> Result<Skill> {
    let text = text.trim_start_matches('\u{feff}').replace("\r\n", "\n");
    let Some(rest) = text.strip_prefix("---\n") else {
        return fail("O SKILL.md precisa começar com um cabeçalho --- com name e description");
    };
    let Some((header, body)) = rest.split_once("\n---") else {
        return fail("Cabeçalho do SKILL.md sem o --- de fechamento");
    };
    let mut skill = Skill::default();
    let mut in_tools = false;
    for line in header.lines() {
        if let Some(item) = line.trim().strip_prefix("- ").filter(|_| in_tools) {
            skill.tools.push(unquote(item));
            continue;
        }
        let Some((key, value)) = line.split_once(':') else {
            continue;
        };
        in_tools = false;
        match key.trim() {
            "name" => skill.name = unquote(value),
            "description" => skill.description = Some(unquote(value)).filter(|d| !d.is_empty()),
            "allowed-tools" | "tools" => {
                skill.tools = value.split(',').map(unquote).filter(|t| !t.is_empty()).collect();
                in_tools = skill.tools.is_empty();
            }
            _ => {}
        }
    }
    if skill.name.is_empty() {
        return fail("O SKILL.md precisa do campo name");
    }
    skill.instructions = body.trim_start_matches('-').trim().to_string();
    Ok(skill)
}
