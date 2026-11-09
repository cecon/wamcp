//! A plugin's skills live in the skill library under `<plugin name>: <skill>`, so agents get them
//! like any other skill. Installing, updating and removing the plugin keeps them in step.
use super::PluginService;
use crate::domain::error::Result;
use crate::domain::model::Skill;
use crate::domain::plugins::Manifest;

impl PluginService {
    /// Moves the library from `previous`'s skills to `next`'s (`None` = none).
    pub(super) fn sync_skills(&self, previous: Option<&Manifest>, next: Option<&Manifest>) -> Result<()> {
        let library = self.repo.skills()?;
        let wanted: Vec<String> = next
            .map(|m| m.skills.iter().map(|s| m.skill_name(s)).collect())
            .unwrap_or_default();
        if let Some(previous) = previous {
            for skill in &previous.skills {
                let name = previous.skill_name(skill);
                if wanted.contains(&name) {
                    continue;
                }
                if let Some(stale) = library.iter().find(|s| s.name.eq_ignore_ascii_case(&name)) {
                    self.repo.delete_skill(stale.id)?;
                }
            }
        }
        let Some(next) = next else {
            return Ok(());
        };
        let tools: Vec<String> = next.tools.iter().map(|t| next.tool_name(t)).collect();
        for skill in &next.skills {
            let name = next.skill_name(skill);
            let existing = library.iter().find(|s| s.name.eq_ignore_ascii_case(&name));
            self.repo.save_skill(&Skill {
                id: existing.map_or(0, |s| s.id),
                name,
                description: Some(skill.description.clone()).filter(|d| !d.trim().is_empty()),
                instructions: skill.instructions.clone(),
                tools: tools.clone(),
                created: String::new(),
            })?;
        }
        Ok(())
    }
}
