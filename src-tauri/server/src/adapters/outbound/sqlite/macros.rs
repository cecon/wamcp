use super::db::{int, iso, now_ms, text, Shape, SqliteStore};
use crate::application::ports::MacroRepo;
use crate::domain::error::{Error, Result};
use crate::domain::model::{Action, Macro};

const MACRO: &str = "SELECT m.*, u.name AS created_by_name FROM macros m LEFT JOIN users u ON u.id=m.created_by";
const SHAPE: Shape = Shape {
    json: &["actions"],
    bools: &[],
};

impl MacroRepo for SqliteStore {
    fn macros(&self, user_id: i64) -> Result<Vec<Macro>> {
        let sql = format!("{MACRO} WHERE m.visibility='global' OR m.created_by=? ORDER BY m.name COLLATE NOCASE, m.id");
        self.rows(&sql, vec![int(user_id)], SHAPE)
    }

    fn macro_by_id(&self, id: i64) -> Result<Option<Macro>> {
        self.row(&format!("{MACRO} WHERE m.id=?"), vec![int(id)], SHAPE)
    }

    fn create_macro(&self, name: &str, visibility: &str, created_by: i64, actions: &[Action]) -> Result<Macro> {
        let id = self.insert(
            "INSERT INTO macros(name,visibility,created_by,actions,created) VALUES(?,?,?,?,?)",
            vec![
                text(name),
                text(visibility),
                int(created_by),
                text(serde_json::to_string(actions)?),
                text(iso(now_ms())),
            ],
        )?;
        self.macro_by_id(id)?.ok_or_else(|| Error::internal("macro vanished"))
    }

    fn update_macro(
        &self,
        id: i64,
        name: Option<&str>,
        visibility: Option<&str>,
        actions: Option<&[Action]>,
    ) -> Result<Macro> {
        let mut fields = Vec::new();
        if let Some(name) = name {
            fields.push(("name", text(name)));
        }
        if let Some(visibility) = visibility {
            fields.push(("visibility", text(visibility)));
        }
        if let Some(actions) = actions {
            fields.push(("actions", text(serde_json::to_string(actions)?)));
        }
        self.update_fields("macros", int(id), fields)?;
        self.macro_by_id(id)?.ok_or_else(|| Error::internal("macro vanished"))
    }

    fn delete_macro(&self, id: i64) -> Result<()> {
        self.exec("DELETE FROM macros WHERE id=?", vec![int(id)]).map(drop)
    }
}
