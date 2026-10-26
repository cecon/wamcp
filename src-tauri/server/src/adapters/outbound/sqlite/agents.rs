use super::db::{flag, int, iso, now_ms, opt_int, opt_text, text, Shape, SqliteStore, PLAIN};
use crate::application::ports::AgentsRepo;
use crate::domain::error::{Error, Result};
use crate::domain::model::{AgentCredential, RosterAgent, RosterAgentDraft, Skill};

const AGENT: &str = "SELECT a.*, u.name AS user_name,
  (SELECT json_group_array(s.skill_id) FROM agent_skills s WHERE s.agent_id=a.id) AS skill_ids,
  (SELECT COUNT(*) FROM agent_credentials c WHERE c.agent_id=a.id) AS credential_count
  FROM agents a LEFT JOIN users u ON u.id=a.user_id";
const AGENT_SHAPE: Shape = Shape {
    json: &["skill_ids"],
    bools: &["active"],
};
const SKILL_SHAPE: Shape = Shape {
    json: &["tools"],
    bools: &[],
};
const CREDENTIAL: &str = "SELECT id,agent_id,name,kind,created,last_used FROM agent_credentials";

impl AgentsRepo for SqliteStore {
    fn agents(&self) -> Result<Vec<RosterAgent>> {
        self.rows(
            &format!("{AGENT} ORDER BY a.kind DESC, a.name COLLATE NOCASE"),
            vec![],
            AGENT_SHAPE,
        )
    }

    fn agent(&self, id: i64) -> Result<Option<RosterAgent>> {
        self.row(&format!("{AGENT} WHERE a.id=?"), vec![int(id)], AGENT_SHAPE)
    }

    fn save_agent(&self, agent: &RosterAgentDraft) -> Result<RosterAgent> {
        let mut values = vec![
            text(&agent.name),
            text(&agent.kind),
            text(&agent.role),
            opt_text(agent.description.as_deref()),
            opt_int(agent.user_id),
            opt_text(agent.whatsapp_jid.as_deref()),
            opt_text(agent.runtime.as_deref()),
            opt_text(agent.model.as_deref()),
            opt_text(agent.instructions.as_deref()),
            flag(agent.active),
        ];
        let id = if agent.id == 0 {
            values.push(text(iso(now_ms())));
            self.insert(
                "INSERT INTO agents(name,kind,role,description,user_id,whatsapp_jid,runtime,model,instructions,active,created)
                 VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                values,
            )?
        } else {
            values.push(int(agent.id));
            self.exec(
                "UPDATE agents SET name=?,kind=?,role=?,description=?,user_id=?,whatsapp_jid=?,runtime=?,model=?,
                 instructions=?,active=? WHERE id=?",
                values,
            )?;
            agent.id
        };
        self.agent(id)?.ok_or_else(|| Error::internal("agent vanished"))
    }

    fn delete_agent(&self, id: i64) -> Result<()> {
        self.exec("DELETE FROM agents WHERE id=?", vec![int(id)]).map(drop)
    }

    fn set_agent_skills(&self, agent_id: i64, skill_ids: &[i64]) -> Result<()> {
        self.transaction(&mut || {
            self.exec("DELETE FROM agent_skills WHERE agent_id=?", vec![int(agent_id)])?;
            for skill in skill_ids {
                self.exec(
                    "INSERT OR IGNORE INTO agent_skills(agent_id,skill_id) VALUES(?,?)",
                    vec![int(agent_id), int(*skill)],
                )?;
            }
            Ok(())
        })
    }

    fn skills(&self) -> Result<Vec<Skill>> {
        self.rows("SELECT * FROM skills ORDER BY name COLLATE NOCASE", vec![], SKILL_SHAPE)
    }

    fn skill(&self, id: i64) -> Result<Option<Skill>> {
        self.row("SELECT * FROM skills WHERE id=?", vec![int(id)], SKILL_SHAPE)
    }

    fn skill_name_taken(&self, name: &str, except_id: i64) -> Result<bool> {
        let sql = "SELECT COUNT(*) FROM skills WHERE name=? AND id<>?";
        Ok(self.scalar(sql, vec![text(name), int(except_id)])?.unwrap_or(0) > 0)
    }

    fn save_skill(&self, skill: &Skill) -> Result<Skill> {
        let mut values = vec![
            text(&skill.name),
            opt_text(skill.description.as_deref()),
            text(&skill.instructions),
            text(serde_json::to_string(&skill.tools)?),
        ];
        let id = if skill.id == 0 {
            values.push(text(iso(now_ms())));
            self.insert(
                "INSERT INTO skills(name,description,instructions,tools,created) VALUES(?,?,?,?,?)",
                values,
            )?
        } else {
            values.push(int(skill.id));
            self.exec(
                "UPDATE skills SET name=?,description=?,instructions=?,tools=? WHERE id=?",
                values,
            )?;
            skill.id
        };
        self.skill(id)?.ok_or_else(|| Error::internal("skill vanished"))
    }

    fn delete_skill(&self, id: i64) -> Result<()> {
        self.exec("DELETE FROM skills WHERE id=?", vec![int(id)]).map(drop)
    }

    fn agent_credentials(&self, agent_id: i64) -> Result<Vec<AgentCredential>> {
        let sql = format!("{CREDENTIAL} WHERE agent_id=? ORDER BY name");
        self.rows(&sql, vec![int(agent_id)], PLAIN)
    }

    fn agent_credential_name_taken(&self, agent_id: i64, name: &str) -> Result<bool> {
        let sql = "SELECT COUNT(*) FROM agent_credentials WHERE agent_id=? AND name=?";
        Ok(self.scalar(sql, vec![int(agent_id), text(name)])?.unwrap_or(0) > 0)
    }

    fn add_agent_credential(&self, agent_id: i64, name: &str, kind: &str, sealed: &str) -> Result<AgentCredential> {
        let id = self.insert(
            "INSERT INTO agent_credentials(agent_id,name,kind,secret,created) VALUES(?,?,?,?,?)",
            vec![int(agent_id), text(name), text(kind), text(sealed), text(iso(now_ms()))],
        )?;
        self.row(&format!("{CREDENTIAL} WHERE id=?"), vec![int(id)], PLAIN)?
            .ok_or_else(|| Error::internal("credential vanished"))
    }

    fn delete_agent_credential(&self, agent_id: i64, id: i64) -> Result<bool> {
        let sql = "DELETE FROM agent_credentials WHERE agent_id=? AND id=?";
        Ok(self.exec(sql, vec![int(agent_id), int(id)])? > 0)
    }
}
