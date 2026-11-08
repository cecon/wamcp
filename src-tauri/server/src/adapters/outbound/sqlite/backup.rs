//! Before migrating an existing database, a consistent copy of it (`VACUUM INTO`) goes to
//! `<data dir>/backups/wamcp-v<version>-<time>.sqlite`, so an update that goes wrong can be undone
//! by putting the copy back. Only the newest `KEEP` copies stay.
use super::migrations::migrations;
use crate::domain::error::{Error, Result};
use rusqlite::Connection;
use std::path::{Path, PathBuf};

pub const KEEP: usize = 3;

/// Copies the database when it has data (version > 0) and migrations still to run.
pub fn before_migrating(conn: &Connection, dir: &Path) -> Result<Option<PathBuf>> {
    let version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    let pending = usize::try_from(version).is_ok_and(|v| v < migrations().len());
    if version == 0 || !pending {
        return Ok(None);
    }
    let folder = dir.join("backups");
    std::fs::create_dir_all(&folder).map_err(Error::internal)?;
    let stamp = chrono::Utc::now().format("%Y%m%dT%H%M%S");
    let target = folder.join(format!("wamcp-v{version}-{stamp}.sqlite"));
    let _ = std::fs::remove_file(&target);
    conn.execute("VACUUM INTO ?", [target.to_string_lossy()])?;
    prune(&folder);
    Ok(Some(target))
}

fn prune(folder: &Path) {
    let Ok(entries) = std::fs::read_dir(folder) else {
        return;
    };
    let mut copies: Vec<(std::time::SystemTime, PathBuf)> = entries
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| {
            p.file_name()
                .and_then(|n| n.to_str())
                .is_some_and(|n| n.starts_with("wamcp-v") && n.ends_with(".sqlite"))
        })
        .filter_map(|p| Some((p.metadata().ok()?.modified().ok()?, p)))
        .collect();
    copies.sort_by_key(|c| std::cmp::Reverse(c.0));
    for (_, old) in copies.into_iter().skip(KEEP) {
        let _ = std::fs::remove_file(old);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn copies_only_a_database_with_migrations_to_run_and_keeps_the_newest() {
        let dir = std::env::temp_dir().join(format!("wamcp-backup-{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(&dir).unwrap();
        let conn = Connection::open(dir.join("wamcp.sqlite")).unwrap();
        assert_eq!(
            before_migrating(&conn, &dir).unwrap(),
            None,
            "a new database has nothing to keep"
        );
        conn.execute_batch("CREATE TABLE t(x);INSERT INTO t VALUES(42);PRAGMA user_version=5;")
            .unwrap();
        let copy = before_migrating(&conn, &dir).unwrap().expect("copied");
        let restored = Connection::open(&copy).unwrap();
        let value: i64 = restored.query_row("SELECT x FROM t", [], |r| r.get(0)).unwrap();
        assert_eq!(value, 42);
        // Windows does not delete a file that is still open.
        drop(restored);
        for n in 0..5 {
            std::fs::write(dir.join("backups").join(format!("wamcp-v1-old{n}.sqlite")), b"").unwrap();
        }
        prune(&dir.join("backups"));
        assert_eq!(std::fs::read_dir(dir.join("backups")).unwrap().count(), KEEP);
        let current = migrations().len();
        conn.execute_batch(&format!("PRAGMA user_version={current};")).unwrap();
        assert_eq!(before_migrating(&conn, &dir).unwrap(), None, "up to date");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
