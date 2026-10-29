//! Runs an approved proposal of the system agent, as the administrator who approved it.
use super::{blank, parse, AgentArgs, AgentSkillsArgs, InboxArgs, SkillArgs, SystemAgent};
use crate::domain::actor::Actor;
use crate::domain::error::{fail, Result};
use crate::domain::model::{RosterAgentDraft, Skill, SystemProposal};
use serde_json::{json, Value};

impl SystemAgent {
    pub(super) fn apply(&self, actor: &Actor, proposal: &SystemProposal) -> Result<Value> {
        let args = &proposal.args;
        match proposal.action.as_str() {
            "create_skill" => {
                let a: SkillArgs = parse(args)?;
                let skill = Skill {
                    name: a.name.trim().into(),
                    description: blank(a.description),
                    instructions: a.instructions,
                    tools: a.tools,
                    ..Skill::default()
                };
                let saved = self.agents.save_skill(actor, &skill)?;
                Ok(json!({ "skill_id": saved.id, "name": saved.name }))
            }
            "create_agent" => {
                let a: AgentArgs = parse(args)?;
                let draft = RosterAgentDraft {
                    name: a.name.trim().into(),
                    kind: "ai".into(),
                    profile_id: Some(a.profile_id),
                    description: blank(a.description),
                    runtime: Some(a.runtime),
                    model: blank(a.model),
                    instructions: blank(a.instructions),
                    active: true,
                    ..RosterAgentDraft::default()
                };
                let saved = self.agents.save_agent(actor, &draft)?;
                if !a.skill_ids.is_empty() {
                    self.agents.set_agent_skills(actor, saved.id, &a.skill_ids)?;
                }
                Ok(json!({ "agent_id": saved.id, "name": saved.name }))
            }
            "set_agent_skills" => {
                let a: AgentSkillsArgs = parse(args)?;
                let saved = self.agents.set_agent_skills(actor, a.agent_id, &a.skill_ids)?;
                Ok(json!({ "agent_id": saved.id, "skill_ids": saved.skill_ids }))
            }
            "connect_inbox" => {
                let a: InboxArgs = parse(args)?;
                let inbox = self.agents.connect_inbox(actor, a.inbox_id, a.agent_id)?;
                Ok(json!({ "inbox_id": inbox.id, "ai_agent_id": inbox.ai_agent_id }))
            }
            other => fail(format!("Ação desconhecida: {other}")),
        }
    }
}
