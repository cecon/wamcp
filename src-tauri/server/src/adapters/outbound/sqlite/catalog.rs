use super::db::{flag, int, opt_text, placeholders, text, SqliteStore, PLAIN};
use crate::application::ports::CatalogRepo;
use crate::domain::error::{Error, Result};
use crate::domain::model::{CannedResponse, Label, LabelFields};
use rusqlite::types::Value as Sql;

impl CatalogRepo for SqliteStore {
    fn labels(&self) -> Result<Vec<Label>> {
        self.rows("SELECT * FROM labels ORDER BY title", vec![], PLAIN)
    }

    fn label(&self, id: i64) -> Result<Option<Label>> {
        self.row("SELECT * FROM labels WHERE id=?", vec![int(id)], PLAIN)
    }

    fn label_by_title(&self, title: &str, except_id: i64) -> Result<Option<Label>> {
        self.row(
            "SELECT * FROM labels WHERE title=? AND id<>?",
            vec![text(title), int(except_id)],
            PLAIN,
        )
    }

    fn labels_by_titles(&self, titles: &[String]) -> Result<Vec<Label>> {
        let sql = format!("SELECT * FROM labels WHERE title IN ({})", placeholders(titles.len()));
        self.rows(&sql, titles.iter().map(|t| text(t.as_str())).collect(), PLAIN)
    }

    fn create_label(&self, title: &str, fields: &LabelFields) -> Result<Label> {
        let id = self.insert(
            "INSERT INTO labels(title,description,color,show_on_sidebar) VALUES(?,?,?,?)",
            vec![
                text(title),
                opt_text(fields.description.clone().flatten().as_deref()),
                text(
                    fields
                        .color
                        .clone()
                        .filter(|c| !c.is_empty())
                        .unwrap_or_else(|| "#1f93ff".into()),
                ),
                flag(fields.show_on_sidebar.unwrap_or(true)),
            ],
        )?;
        self.label(id)?.ok_or_else(|| Error::internal("label vanished"))
    }

    fn update_label(&self, id: i64, title: Option<&str>, fields: &LabelFields) -> Result<Label> {
        let mut changes: Vec<(&str, Sql)> = Vec::new();
        if let Some(title) = title {
            changes.push(("title", text(title)));
        }
        if let Some(description) = &fields.description {
            changes.push(("description", opt_text(description.as_deref())));
        }
        if let Some(color) = &fields.color {
            changes.push(("color", text(color.as_str())));
        }
        if let Some(show) = fields.show_on_sidebar {
            changes.push(("show_on_sidebar", flag(show)));
        }
        self.update_fields("labels", int(id), changes)?;
        self.label(id)?.ok_or_else(|| Error::internal("label vanished"))
    }

    fn delete_label(&self, id: i64) -> Result<()> {
        self.exec("DELETE FROM labels WHERE id=?", vec![int(id)]).map(drop)
    }

    fn canned_responses(&self, q: &str) -> Result<Vec<CannedResponse>> {
        let like = text(format!("%{q}%"));
        let sql =
            "SELECT * FROM canned_responses WHERE short_code LIKE ? OR content LIKE ? ORDER BY short_code LIMIT 200";
        self.rows(sql, vec![like.clone(), like], PLAIN)
    }

    fn canned_response(&self, id: i64) -> Result<Option<CannedResponse>> {
        self.row("SELECT * FROM canned_responses WHERE id=?", vec![int(id)], PLAIN)
    }

    fn canned_by_code(&self, code: &str, except_id: i64) -> Result<Option<CannedResponse>> {
        let sql = "SELECT * FROM canned_responses WHERE short_code=? AND id<>?";
        self.row(sql, vec![text(code), int(except_id)], PLAIN)
    }

    fn create_canned(&self, code: &str, content: &str) -> Result<CannedResponse> {
        let id = self.insert(
            "INSERT INTO canned_responses(short_code,content) VALUES(?,?)",
            vec![text(code), text(content)],
        )?;
        self.canned_response(id)?
            .ok_or_else(|| Error::internal("canned vanished"))
    }

    fn update_canned(&self, id: i64, code: Option<&str>, content: Option<&str>) -> Result<CannedResponse> {
        let mut changes: Vec<(&str, Sql)> = Vec::new();
        if let Some(code) = code {
            changes.push(("short_code", text(code)));
        }
        if let Some(content) = content {
            changes.push(("content", text(content)));
        }
        self.update_fields("canned_responses", int(id), changes)?;
        self.canned_response(id)?
            .ok_or_else(|| Error::internal("canned vanished"))
    }

    fn delete_canned(&self, id: i64) -> Result<()> {
        self.exec("DELETE FROM canned_responses WHERE id=?", vec![int(id)])
            .map(drop)
    }
}
