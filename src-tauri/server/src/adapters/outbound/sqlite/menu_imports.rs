//! iFood import runs: status, counts, the converted preview and the captured payload (JSON columns).
use super::db::{int, opt_int, opt_text, text, Shape, SqliteStore};
use super::menu::json;
use crate::application::ports::MenuImportRepo;
use crate::domain::error::Result;
use crate::domain::menu::import::MenuImport;

const IMPORTS: Shape = Shape {
    json: &["counts", "preview", "payload"],
    bools: &[],
};

impl MenuImportRepo for SqliteStore {
    fn save_menu_import(&self, i: &MenuImport) -> Result<()> {
        self.exec(
            "INSERT OR REPLACE INTO menu_imports(id,url,status,message,counts,preview,payload,started_at,finished_at)
             VALUES(?,?,?,?,?,?,?,?,?)",
            vec![
                text(&i.id),
                text(&i.url),
                text(&i.status),
                opt_text(i.message.as_deref()),
                json(&i.counts)?,
                json(&i.preview)?,
                json(&i.payload)?,
                int(i.started_at),
                opt_int(i.finished_at),
            ],
        )
        .map(drop)
    }

    fn menu_import(&self, id: &str) -> Result<Option<MenuImport>> {
        self.row("SELECT * FROM menu_imports WHERE id=?", vec![text(id)], IMPORTS)
    }

    fn fail_stale_imports(&self, message: &str) -> Result<()> {
        self.exec(
            "UPDATE menu_imports SET status='failed',message=?
             WHERE status IN ('starting','opening','waiting_human','loading')",
            vec![text(message)],
        )
        .map(drop)
    }
}
