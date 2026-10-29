//! What an AI agent knows about itself when a person of the team talks to it in the app: its company,
//! its colleagues and direct supervisor, and the channels it answers, with the newest conversations
//! that reached it there.
//! Without this it would ask the person things it should know (which repository it watches…).
use super::model::{Conversation, Inbox, RosterAgent};

/// Newest conversations of a channel the agent sees.
pub const RECENT_CONVERSATIONS: usize = 10;
/// Most colleagues listed.
const TEAM_LIMIT: usize = 40;
/// Longest preview of a conversation's last message.
const PREVIEW_CHARS: usize = 200;

/// A channel the agent answers; `recent` is empty when the person may not see that inbox.
pub struct AgentChannel {
    pub inbox: Inbox,
    pub recent: Vec<Conversation>,
}

/// Who the agent works with: the company and its roster (the agent itself included or not).
pub struct Workplace<'a> {
    pub company: &'a str,
    pub team: &'a [RosterAgent],
}

/// The prompt section about the agent itself.
pub fn agent_context(agent: &RosterAgent, workplace: &Workplace, channels: &[AgentChannel]) -> String {
    let mut text = format!("Sobre você: {}", member(agent));
    if let Some(description) = agent.description.as_deref().filter(|d| !d.trim().is_empty()) {
        text.push_str(&format!(" {}", description.trim()));
    }
    text.push_str(&format!("\nVocê trabalha na empresa {}.\n", workplace.company.trim()));
    let colleagues: Vec<&RosterAgent> = workplace
        .team
        .iter()
        .filter(|m| m.id != agent.id && m.active && !m.system)
        .take(TEAM_LIMIT)
        .collect();
    match colleagues.iter().find(|m| Some(m.id) == agent.supervisor_id) {
        Some(boss) => text.push_str(&format!(
            "Seu responsável direto é {}: peça a ele permissão para o que você não pode decidir sozinho.\n",
            boss.name
        )),
        None => text.push_str("Ninguém está definido como seu responsável direto.\n"),
    }
    if !colleagues.is_empty() {
        text.push_str("Sua equipe:\n");
    }
    for colleague in colleagues {
        let mut line = format!("- {}", member(colleague));
        if Some(colleague.id) == agent.supervisor_id {
            line.push_str(" (seu responsável)");
        } else if colleague.supervisor_id == Some(agent.id) {
            line.push_str(" (responde a você)");
        }
        if let Some(description) = colleague.description.as_deref().filter(|d| !d.trim().is_empty()) {
            line.push_str(&format!(": {}", description.trim()));
        }
        text.push_str(&format!("{line}\n"));
    }
    if channels.is_empty() {
        text.push_str("Você ainda não atende nenhum canal.\n");
    } else {
        text.push_str("Canais que você atende (o que chega por eles é com você):\n");
    }
    for channel in channels {
        text.push_str(&format!("- {}: {}\n", channel.inbox.name, channel_kind(&channel.inbox)));
        if !channel.recent.is_empty() {
            text.push_str("  Mais recentes:\n");
        }
        for conversation in &channel.recent {
            text.push_str(&format!("  - {}\n", conversation_line(conversation)));
        }
    }
    text.push_str(
        "Nesta conversa você não tem ferramentas nem acesso a comandos: responda com o que está aqui e, \
         se faltar algo, diga o que falta em vez de prometer buscar.\n",
    );
    text
}

/// "Name (agente de IA, perfil Financeiro)": who a member is, without contacts or secrets.
fn member(m: &RosterAgent) -> String {
    let kind = if m.kind == "ai" { "agente de IA" } else { "pessoa" };
    match m.profile_name.as_deref().map(str::trim).filter(|p| !p.is_empty()) {
        Some(profile) => format!("{} ({kind}, perfil {profile})", m.name),
        None => format!("{} ({kind})", m.name),
    }
}

fn channel_kind(inbox: &Inbox) -> String {
    match (inbox.channel_type.as_str(), &inbox.github_repo) {
        ("github", Some(repo)) => {
            format!("GitHub, repositório {repo} (pull requests, issues, falhas do Actions e pushes)")
        }
        ("github", None) => "GitHub".into(),
        _ => match inbox.phone.as_deref() {
            Some(phone) => format!("WhatsApp {phone}"),
            None => "WhatsApp".into(),
        },
    }
}

fn conversation_line(conversation: &Conversation) -> String {
    let name = conversation.contact_name.as_deref().unwrap_or("sem nome");
    let mut line = format!(
        "{} \"{}\" ({})",
        conversation.contact_jid,
        name,
        status(&conversation.status)
    );
    if let Some(last) = conversation
        .last_message
        .as_deref()
        .map(str::trim)
        .filter(|m| !m.is_empty())
    {
        let preview: String = last.chars().take(PREVIEW_CHARS).collect();
        let more = if last.chars().count() > PREVIEW_CHARS {
            "…"
        } else {
            ""
        };
        line.push_str(&format!(": {}{more}", preview.replace('\n', " ")));
    }
    line
}

fn status(status: &str) -> &str {
    match status {
        "open" => "aberta",
        "pending" => "pendente",
        "resolved" => "resolvida",
        "snoozed" => "adiada",
        other => other,
    }
}
