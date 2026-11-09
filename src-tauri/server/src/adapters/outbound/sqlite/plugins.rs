//! `PluginRepo` over SQLite: one row per installed plugin (its manifest as JSON) and the sealed
//! values of its credentials.
use super::db::{int, iso, now_ms, text, SqliteStore};
use crate::application::ports::{InstalledPlugin, PluginRepo};
use crate::domain::error::Result;
use crate::domain::plugins::Manifest;
use rusqlite::OptionalExtension;

type Row = (String, i64, i64, String, String, Option<String>);

fn installed(row: &rusqlite::Row<'_>) -> rusqlite::Result<Row> {
    Ok((
        row.get(0)?,
        row.get(1)?,
        row.get(2)?,
        row.get(3)?,
        row.get(4)?,
        row.get(5)?,
    ))
}

fn decode(parts: Row) -> Option<InstalledPlugin> {
    let (json, enabled, builtin, installed, updated, source) = parts;
    let manifest: Manifest = serde_json::from_str(&json).ok()?;
    Some(InstalledPlugin {
        manifest,
        enabled: enabled != 0,
        builtin: builtin != 0,
        installed,
        updated,
        source,
    })
}

const SELECT: &str = "SELECT manifest,enabled,builtin,installed,updated,source FROM plugins";

impl PluginRepo for SqliteStore {
    fn plugins(&self) -> Result<Vec<InstalledPlugin>> {
        let rows = self.with(|db| {
            let mut statement = db.prepare(&format!("{SELECT} ORDER BY builtin DESC,id"))?;
            let rows = statement.query_map([], installed)?;
            rows.collect::<rusqlite::Result<Vec<_>>>()
        })?;
        Ok(rows.into_iter().filter_map(decode).collect())
    }

    fn plugin(&self, id: &str) -> Result<Option<InstalledPlugin>> {
        let row = self.with(|db| {
            db.query_row(&format!("{SELECT} WHERE id=?"), [id], installed)
                .optional()
        })?;
        Ok(row.and_then(decode))
    }

    fn save_plugin(&self, manifest: &Manifest, builtin: bool) -> Result<InstalledPlugin> {
        let now = iso(now_ms());
        self.exec(
            "INSERT INTO plugins(id,manifest,enabled,builtin,installed,updated) VALUES(?,?,1,?,?,?)
             ON CONFLICT(id) DO UPDATE SET manifest=excluded.manifest,updated=excluded.updated",
            vec![
                text(&manifest.id),
                text(serde_json::to_string(manifest)?),
                int(i64::from(builtin)),
                text(&now),
                text(&now),
            ],
        )?;
        self.plugin(&manifest.id)?
            .ok_or_else(|| crate::domain::error::Error::Internal("plugin não gravado".into()))
    }

    fn set_plugin_enabled(&self, id: &str, enabled: bool) -> Result<()> {
        self.exec(
            "UPDATE plugins SET enabled=?,updated=? WHERE id=?",
            vec![int(i64::from(enabled)), text(iso(now_ms())), text(id)],
        )
        .map(drop)
    }

    fn set_plugin_source(&self, id: &str, source: Option<&str>) -> Result<()> {
        let source = source.map_or(rusqlite::types::Value::Null, text);
        self.exec("UPDATE plugins SET source=? WHERE id=?", vec![source, text(id)])
            .map(drop)
    }

    fn delete_plugin(&self, id: &str) -> Result<()> {
        self.exec("DELETE FROM plugins WHERE id=?", vec![text(id)]).map(drop)
    }

    fn plugin_credential_names(&self, id: &str) -> Result<Vec<String>> {
        self.with(|db| {
            let mut statement = db.prepare("SELECT name FROM plugin_credentials WHERE plugin_id=? ORDER BY name")?;
            let rows = statement.query_map([id], |row| row.get(0))?;
            rows.collect()
        })
    }

    fn plugin_credential(&self, id: &str, name: &str) -> Result<Option<String>> {
        self.with(|db| {
            db.query_row(
                "SELECT secret FROM plugin_credentials WHERE plugin_id=? AND name=?",
                [id, name],
                |row| row.get(0),
            )
            .optional()
        })
    }

    fn set_plugin_credential(&self, id: &str, name: &str, sealed: Option<&str>) -> Result<()> {
        match sealed {
            Some(secret) => self.exec(
                "INSERT INTO plugin_credentials(plugin_id,name,secret,updated) VALUES(?,?,?,?)
                 ON CONFLICT(plugin_id,name) DO UPDATE SET secret=excluded.secret,updated=excluded.updated",
                vec![text(id), text(name), text(secret), text(iso(now_ms()))],
            ),
            None => self.exec(
                "DELETE FROM plugin_credentials WHERE plugin_id=? AND name=?",
                vec![text(id), text(name)],
            ),
        }
        .map(drop)
    }
}
