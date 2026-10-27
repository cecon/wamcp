use super::db::{int, iso, now_ms, opt_text, text, Shape, SqliteStore};
use crate::application::ports::RoleRepo;
use crate::domain::error::{Error, Result};
use crate::domain::model::CustomRole;

const ROLE: Shape = Shape {
    json: &["permissions"],
    bools: &["builtin"],
};

impl RoleRepo for SqliteStore {
    fn custom_roles(&self) -> Result<Vec<CustomRole>> {
        self.rows("SELECT * FROM custom_roles ORDER BY name", vec![], ROLE)
    }

    fn custom_role(&self, id: i64) -> Result<Option<CustomRole>> {
        self.row("SELECT * FROM custom_roles WHERE id=?", vec![int(id)], ROLE)
    }

    fn role_name_taken(&self, name: &str, except_id: i64) -> Result<bool> {
        let sql = "SELECT COUNT(*) FROM custom_roles WHERE name=? AND id<>?";
        Ok(self.scalar(sql, vec![text(name), int(except_id)])?.unwrap_or(0) > 0)
    }

    /// Inserts when `id` is 0, otherwise replaces name, description and permissions.
    fn save_custom_role(&self, role: &CustomRole) -> Result<CustomRole> {
        let permissions = text(serde_json::to_string(&role.permissions)?);
        let id = if role.id == 0 {
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
        };
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
        self.row("SELECT * FROM custom_roles WHERE builtin=1", vec![], ROLE)
    }
}
