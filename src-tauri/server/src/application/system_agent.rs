//! The system agent's side of the app: who may talk to it (administrators, from the WhatsApp number
//! of their roster entry), the short-lived runs its runtime authenticates with on the app's MCP
//! endpoint, and its tools. Reads run at once; changes become proposals that run only after the
//! administrator approves them in a later message, as that administrator.
mod actions;

use super::agents::AgentDirectory;
use crate::domain::actor::Actor;
use crate::domain::error::{fail, fail_with, HelpdeskError, Result};
use crate::domain::model::{Conversation, SystemProposal, User};
use crate::domain::system::same_number;
use parking_lot::Mutex;
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Arc;

/// One answer being written: the conversation it belongs to and the administrator it acts for.
#[derive(Clone)]
struct Run {
    conversation_id: i64,
    admin: User,
}

#[derive(Clone)]
pub struct SystemAgent {
    agents: AgentDirectory,
    runs: Arc<Mutex<HashMap<String, Run>>>,
}

#[derive(Deserialize)]
struct SkillArgs {
    name: String,
    description: Option<String>,
    instructions: String,
    #[serde(default)]
    tools: Vec<String>,
}

#[derive(Deserialize)]
struct AgentArgs {
    name: String,
    profile_id: i64,
    runtime: String,
    model: Option<String>,
    description: Option<String>,
    instructions: Option<String>,
    #[serde(default)]
    skill_ids: Vec<i64>,
}

#[derive(Deserialize)]
struct AgentSkillsArgs {
    agent_id: i64,
    skill_ids: Vec<i64>,
}

#[derive(Deserialize)]
struct InboxArgs {
    inbox_id: i64,
    agent_id: Option<i64>,
}

#[derive(Deserialize)]
struct IdArgs {
    id: i64,
}

fn parse<T: for<'de> Deserialize<'de>>(args: &Value) -> Result<T> {
    serde_json::from_value(args.clone()).or_else(|e| fail(format!("Argumentos inválidos: {e}")))
}

fn blank(value: Option<String>) -> Option<String> {
    value.map(|v| v.trim().to_string()).filter(|v| !v.is_empty())
}

impl SystemAgent {
    pub fn new(agents: AgentDirectory) -> Self {
        Self {
            agents,
            runs: Arc::default(),
        }
    }

    fn repo(&self) -> &Arc<dyn crate::application::ports::Repository> {
        &self.agents.core.repo
    }

    /// The administrator writing in the conversation: an active administrator login whose roster
    /// entry has the contact's WhatsApp number. Anyone else never reaches the system agent.
    pub fn admin_of(&self, conversation: &Conversation) -> Result<Option<User>> {
        let contact = [
            Some(conversation.contact_jid.as_str()),
            conversation.contact_phone.as_deref(),
        ];
        for agent in self.repo().agents()? {
            let (Some(jid), Some(user_id)) = (agent.whatsapp_jid.as_deref(), agent.user_id) else {
                continue;
            };
            if !contact.iter().flatten().any(|c| same_number(c, jid)) {
                continue;
            }
            let user = self.repo().user(user_id)?;
            if let Some(user) = user.filter(|u| u.role == "administrator" && u.active == 1) {
                return Ok(Some(user));
            }
        }
        Ok(None)
    }

    /// Starts a run; the token is the bearer credential of the app's MCP endpoint until it ends.
    pub fn open_run(&self, conversation_id: i64, admin: User) -> String {
        let token = format!("wsys_{}", uuid::Uuid::new_v4().simple());
        self.runs.lock().insert(token.clone(), Run { conversation_id, admin });
        token
    }

    pub fn close_run(&self, token: &str) {
        self.runs.lock().remove(token);
    }

    pub fn authenticates(&self, token: &str) -> bool {
        !token.is_empty() && self.runs.lock().contains_key(token)
    }

    /// Runs one tool for the run that holds `token`; the result is JSON for the model.
    pub fn call(&self, token: &str, name: &str, args: &Value) -> Result<Value> {
        let Some(run) = self.runs.lock().get(token).cloned() else {
            return fail_with("Execução encerrada", 401);
        };
        let actor = Actor::User(run.admin.clone());
        match name {
            "list_agents" => self.list_agents(&actor),
            "list_profiles" => Ok(json!(self
                .repo()
                .custom_roles()?
                .iter()
                .map(|p| json!({ "id": p.id, "name": p.name, "description": p.description, "agent_role": p.agent_role, "skill_ids": p.skill_ids }))
                .collect::<Vec<_>>())),
            "list_skills" => Ok(json!(self
                .agents
                .skills(&actor)?
                .iter()
                .map(|s| json!({ "id": s.id, "name": s.name, "description": s.description, "tools": s.tools }))
                .collect::<Vec<_>>())),
            "list_inboxes" => Ok(json!(self
                .repo()
                .inboxes(None)?
                .iter()
                .map(|i| json!({ "id": i.id, "name": i.name, "ai_agent_id": i.ai_agent_id }))
                .collect::<Vec<_>>())),
            "list_runtimes" => Ok(json!(self.agents.runtimes(&actor)?)),
            "propose_skill" => self.propose_skill(&run, args),
            "propose_agent" => self.propose_agent(&run, args),
            "propose_agent_skills" => {
                let a: AgentSkillsArgs = parse(args)?;
                let agent = self.agent_name(a.agent_id)?;
                let summary = format!("Trocar as skills de {agent} para {:?}", a.skill_ids);
                self.propose(&run, "set_agent_skills", args, summary)
            }
            "propose_inbox_agent" => {
                let a: InboxArgs = parse(args)?;
                let inbox = self.agents.core.inbox(a.inbox_id)?;
                let summary = match a.agent_id {
                    Some(id) => format!("Ligar {} à caixa de entrada {}", self.agent_name(id)?, inbox.name),
                    None => format!("Desligar o agente de IA da caixa de entrada {}", inbox.name),
                };
                self.propose(&run, "connect_inbox", args, summary)
            }
            "execute_proposal" => self.execute(&run, &actor, parse::<IdArgs>(args)?.id),
            "discard_proposal" => {
                let proposal = self.own_proposal(&run, parse::<IdArgs>(args)?.id)?;
                self.repo().decide_proposal(proposal.id, "discarded", None)?;
                Ok(json!({ "id": proposal.id, "status": "discarded" }))
            }
            _ => fail(format!("Ferramenta desconhecida: {name}")),
        }
    }

    fn list_agents(&self, actor: &Actor) -> Result<Value> {
        let agents = self.agents.agents(actor)?;
        Ok(json!(agents
            .iter()
            .map(|a| json!({
                "id": a.id, "name": a.name, "kind": a.kind, "system": a.system, "role": a.role,
                "profile_id": a.profile_id, "profile": a.profile_name, "runtime": a.runtime, "model": a.model,
                "active": a.active, "skill_ids": a.skill_ids, "profile_skill_ids": a.profile_skill_ids,
            }))
            .collect::<Vec<_>>()))
    }

    fn agent_name(&self, id: i64) -> Result<String> {
        match self.repo().agent(id)? {
            Some(agent) => Ok(format!("{} (#{id})", agent.name)),
            None => Err(HelpdeskError::not_found("Agente não encontrado").into()),
        }
    }

    fn propose_skill(&self, run: &Run, args: &Value) -> Result<Value> {
        let a: SkillArgs = parse(args)?;
        crate::domain::agents::validate_tools(&a.tools)?;
        if self.repo().skill_name_taken(a.name.trim(), 0)? {
            return fail("Já existe uma skill com este nome");
        }
        let summary = format!(
            "Criar a skill \"{}\" (ferramentas: {})",
            a.name.trim(),
            a.tools.join(", ")
        );
        self.propose(run, "create_skill", args, summary)
    }

    fn propose_agent(&self, run: &Run, args: &Value) -> Result<Value> {
        let a: AgentArgs = parse(args)?;
        let Some(profile) = self.repo().custom_role(a.profile_id)? else {
            return fail("Perfil não encontrado");
        };
        if profile.agent_role.is_none() {
            return fail("Agentes de IA precisam de um perfil com função (coordenador, operador…)");
        }
        for skill in &a.skill_ids {
            if self.repo().skill(*skill)?.is_none() {
                return fail(format!("Skill {skill} não encontrada"));
            }
        }
        let summary = format!(
            "Criar o agente de IA \"{}\" (perfil {}, runtime {}{}, skills {:?})",
            a.name.trim(),
            profile.name,
            a.runtime,
            blank(a.model).map(|m| format!(", modelo {m}")).unwrap_or_default(),
            a.skill_ids
        );
        self.propose(run, "create_agent", args, summary)
    }

    fn propose(&self, run: &Run, action: &str, args: &Value, summary: String) -> Result<Value> {
        let newest = self.repo().messages(run.conversation_id, None, 1)?;
        let after = newest.last().map_or(0, |m| m.id);
        let proposal = self
            .repo()
            .add_proposal(run.conversation_id, after, action, args, &summary)?;
        Ok(json!({
            "proposal_id": proposal.id,
            "summary": summary,
            "next": "Mostre o resumo e o número da proposta ao administrador e peça a aprovação."
        }))
    }

    fn own_proposal(&self, run: &Run, id: i64) -> Result<SystemProposal> {
        let proposal = self
            .repo()
            .proposal(id)?
            .filter(|p| p.conversation_id == run.conversation_id);
        let Some(proposal) = proposal else {
            return Err(HelpdeskError::not_found("Proposta não encontrada nesta conversa").into());
        };
        if proposal.status != "pending" {
            return fail(format!("A proposta {id} não está pendente ({})", proposal.status));
        }
        Ok(proposal)
    }

    /// Runs an approved proposal as the administrator: approval is a message they sent after it.
    fn execute(&self, run: &Run, actor: &Actor, id: i64) -> Result<Value> {
        let proposal = self.own_proposal(run, id)?;
        let messages = self.repo().messages(run.conversation_id, None, 50)?;
        let approved = messages
            .iter()
            .any(|m| m.id > proposal.after_message_id && m.message_type == "incoming" && !m.private);
        if !approved {
            return fail("O administrador ainda não respondeu a esta proposta: peça a aprovação antes de executar");
        }
        let outcome = self.apply(actor, &proposal);
        let (status, result) = match &outcome {
            Ok(value) => ("done", value.to_string()),
            Err(error) => ("failed", error.to_string()),
        };
        self.repo().decide_proposal(proposal.id, status, Some(&result))?;
        outcome.map(|value| json!({ "id": proposal.id, "status": status, "result": value }))
    }
}
