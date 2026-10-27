use super::db::{int, iso, now_ms, opt_text, text, Shape, SqliteStore};
use crate::application::ports::RoleRepo;
use crate::domain::error::{Error, Result};
use crate::domain::model::CustomRole;

const ROLE: Shape = Shape {
    json: &["permissions", "skill_ids"],
    bools: &["builtin"],
};
const SELECT: &str = "SELECT r.*, (SELECT json_group_array(s.skill_id) FROM custom_role_skills s WHERE s.role_id=r.id)
  AS skill_ids FROM custom_roles r";

impl RoleRepo for SqliteStore {
    fn custom_roles(&self) -> Result<Vec<CustomRole>> {
        self.rows(&format!("{SELECT} ORDER BY r.name"), vec![], ROLE)
    }

    fn custom_role(&self, id: i64) -> Result<Option<CustomRole>> {
        self.row(&format!("{SELECT} WHERE r.id=?"), vec![int(id)], ROLE)
    }

    fn role_name_taken(&self, name: &str, except_id: i64) -> Result<bool> {
        let sql = "SELECT COUNT(*) FROM custom_roles WHERE name=? AND id<>?";
        Ok(self.scalar(sql, vec![text(name), int(except_id)])?.unwrap_or(0) > 0)
    }

    /// Inserts when `id` is 0, otherwise replaces name, description, permissions, AI role and skills.
    fn save_custom_role(&self, role: &CustomRole) -> Result<CustomRole> {
        let mut id = role.id;
        self.transaction(&mut || {
            id = self.write_role(role)?;
            self.exec("DELETE FROM custom_role_skills WHERE role_id=?", vec![int(id)])?;
            for skill in &role.skill_ids {
                let sql = "INSERT OR IGNORE INTO custom_role_skills(role_id,skill_id) VALUES(?,?)";
                self.exec(sql, vec![int(id), int(*skill)])?;
            }
            Ok(())
        })?;
        self.custom_role(id)?.ok_or_else(|| Error::internal("role vanished"))
    }

    /// Moves the users and roster agents of a deleted profile to the built-in one, then deletes it.
    fn delete_custom_role(&self, id: i64) -> Result<()> {
        self.transaction(&mut || {
            let builtin = "(SELECT id FROM custom_roles WHERE builtin=1)";
            self.exec(
                &format!("UPDATE users SET custom_role_id={builtin} WHERE custom_role_id=?"),
                vec![int(id)],
            )?;
            self.exec(
                &format!("UPDATE agents SET profile_id={builtin} WHERE profile_id=?"),
                vec![int(id)],
            )?;
            self.exec("DELETE FROM custom_roles WHERE id=? AND builtin=0", vec![int(id)])
                .map(drop)
        })
    }

    fn builtin_role(&self) -> Result<Option<CustomRole>> {
        self.row(&format!("{SELECT} WHERE r.builtin=1"), vec![], ROLE)
    }
}

impl SqliteStore {
    /// Inserts or updates the profile row; returns its id.
    fn write_role(&self, role: &CustomRole) -> Result<i64> {
        let permissions = text(serde_json::to_string(&role.permissions)?);
        Ok(if role.id == 0 {
            self.insert(
                "INSERT INTO custom_roles(name,description,permissions,agent_role,created) VALUES(?,?,?,?,?)",
                vec![
                    text(role.name.as_str()),
                    opt_text(role.description.as_deref()),
                    permissions,
                    opt_text(role.agent_role.as_deref()),
                    text(iso(now_ms())),
                ],
            )?
        } else {
            let sql = "UPDATE custom_roles SET name=?,description=?,permissions=?,agent_role=? WHERE id=?";
            let params = vec![
                text(role.name.as_str()),
                opt_text(role.description.as_deref()),
                permissions,
                opt_text(role.agent_role.as_deref()),
                int(role.id),
            ];
            self.exec(sql, params)?;
            role.id
        })
    }
}
