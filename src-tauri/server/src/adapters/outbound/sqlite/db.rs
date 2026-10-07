//! The SQLite store: one connection (like the Node version) guarded by a re-entrant lock, so a use
//! case can run several repository calls inside one transaction on the same thread.
use super::migrations::{migrations, BASE, EXTRAS};
use crate::domain::error::{Error, Result};
use parking_lot::ReentrantMutex;
use rusqlite::types::Value as Sql;
use rusqlite::{params_from_iter, Connection, Row};
use serde::de::DeserializeOwned;
use serde_json::{Map, Number, Value};
use std::cell::Cell;
use std::path::Path;

pub struct SqliteStore {
    conn: ReentrantMutex<(Connection, Cell<u32>)>,
}

impl From<rusqlite::Error> for Error {
    fn from(error: rusqlite::Error) -> Self {
        Error::internal(error)
    }
}

/// Columns stored as JSON text and booleans stored as 0/1 that the API exposes as JSON/booleans.
#[derive(Clone, Copy, Default)]
pub struct Shape {
    pub json: &'static [&'static str],
    pub bools: &'static [&'static str],
}

pub const PLAIN: Shape = Shape { json: &[], bools: &[] };

fn row_map(row: &Row, shape: &Shape) -> rusqlite::Result<Map<String, Value>> {
    let statement = row.as_ref();
    let mut map = Map::new();
    for (index, name) in statement.column_names().iter().enumerate() {
        let value = match row.get::<_, Sql>(index)? {
            Sql::Null => Value::Null,
            Sql::Integer(i) if shape.bools.contains(name) => Value::Bool(i != 0),
            Sql::Integer(i) => Value::from(i),
            // Whole averages serialize like JavaScript numbers (120, not 120.0).
            Sql::Real(f) if f.fract() == 0.0 && f.abs() < 9e15 => Value::from(f as i64),
            Sql::Real(f) => Number::from_f64(f).map_or(Value::Null, Value::Number),
            Sql::Text(t) if shape.json.contains(name) => serde_json::from_str(&t).unwrap_or(Value::Null),
            Sql::Text(t) => Value::String(t),
            Sql::Blob(_) => continue,
        };
        map.insert((*name).to_string(), value);
    }
    Ok(map)
}

impl SqliteStore {
    /// Opens (or creates) `wamcp.sqlite` in `dir` and brings the schema up to date.
    pub fn open(dir: &Path) -> Result<Self> {
        std::fs::create_dir_all(dir).map_err(Error::internal)?;
        let conn = Connection::open(dir.join("wamcp.sqlite"))?;
        conn.execute_batch("PRAGMA journal_mode=WAL;")?;
        Self::prepare(conn)
    }

    pub fn in_memory() -> Result<Self> {
        Self::prepare(Connection::open_in_memory()?)
    }

    fn prepare(conn: Connection) -> Result<Self> {
        conn.execute_batch("PRAGMA foreign_keys=ON;")?;
        conn.busy_timeout(std::time::Duration::from_secs(5))?;
        conn.execute_batch(BASE)?;
        let version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
        for (step, sql) in migrations().iter().enumerate().skip(usize::try_from(version).unwrap_or(0)) {
            conn.execute_batch(&format!("BEGIN;{sql};PRAGMA user_version={};COMMIT;", step + 1))
                .inspect_err(|_| {
                    let _ = conn.execute_batch("ROLLBACK");
                })?;
        }
        conn.execute_batch(EXTRAS)?;
        conn.execute("UPDATE sessions SET status='disconnected'", [])?;
        Ok(Self { conn: ReentrantMutex::new((conn, Cell::new(0))) })
    }

    /// Runs `f` with the connection (re-entrant on the same thread).
    pub fn with<T>(&self, f: impl FnOnce(&Connection) -> rusqlite::Result<T>) -> Result<T> {
        let guard = self.conn.lock();
        Ok(f(&guard.0)?)
    }

    pub fn exec(&self, sql: &str, params: Vec<Sql>) -> Result<usize> {
        self.with(|c| c.execute(sql, params_from_iter(params)))
    }

    pub fn rows<T: DeserializeOwned>(&self, sql: &str, params: Vec<Sql>, shape: Shape) -> Result<Vec<T>> {
        let maps = self.with(|c| {
            let mut statement = c.prepare_cached(sql)?;
            let rows = statement.query_map(params_from_iter(params), |row| row_map(row, &shape))?;
            rows.collect::<rusqlite::Result<Vec<_>>>()
        })?;
        maps.into_iter()
            .map(|m| serde_json::from_value(Value::Object(m)).map_err(Error::from))
            .collect()
    }

    pub fn row<T: DeserializeOwned>(&self, sql: &str, params: Vec<Sql>, shape: Shape) -> Result<Option<T>> {
        Ok(self.rows(sql, params, shape)?.into_iter().next())
    }

    /// First column of the first row as an integer (counts, ids).
    pub fn scalar(&self, sql: &str, params: Vec<Sql>) -> Result<Option<i64>> {
        self.with(|c| {
            let mut statement = c.prepare_cached(sql)?;
            let mut rows = statement.query(params_from_iter(params))?;
            match rows.next()? {
                Some(row) => row.get::<_, Option<i64>>(0),
                None => Ok(None),
            }
        })
    }

    pub fn insert(&self, sql: &str, params: Vec<Sql>) -> Result<i64> {
        self.with(|c| {
            c.execute(sql, params_from_iter(params))?;
            Ok(c.last_insert_rowid())
        })
    }

    /// Runs `work` atomically; nested calls become savepoints of the outer transaction.
    pub fn transaction(&self, work: &mut dyn FnMut() -> Result<()>) -> Result<()> {
        let guard = self.conn.lock();
        let depth = guard.1.get();
        let (begin, commit, rollback) = if depth == 0 {
            ("BEGIN IMMEDIATE".to_string(), "COMMIT".to_string(), "ROLLBACK".to_string())
        } else {
            let name = format!("nested_{depth}");
            (format!("SAVEPOINT {name}"), format!("RELEASE {name}"), format!("ROLLBACK TO {name}; RELEASE {name}"))
        };
        guard.0.execute_batch(&begin)?;
        guard.1.set(depth + 1);
        let result = work();
        guard.1.set(depth);
        match result {
            Ok(()) => Ok(guard.0.execute_batch(&commit)?),
            Err(error) => {
                let _ = guard.0.execute_batch(&rollback);
                Err(error)
            }
        }
    }

    /// `UPDATE table SET k=?… WHERE id=?` with only the given columns; no-op when empty.
    pub fn update_fields(&self, table: &str, id: Sql, fields: Vec<(&str, Sql)>) -> Result<()> {
        if fields.is_empty() {
            return Ok(());
        }
        let sets: Vec<String> = fields.iter().map(|(k, _)| format!("{k}=?")).collect();
        let mut params: Vec<Sql> = fields.into_iter().map(|(_, v)| v).collect();
        params.push(id);
        self.exec(&format!("UPDATE {table} SET {} WHERE id=?", sets.join(",")), params)?;
        Ok(())
    }
}

/// ISO-8601 timestamp (UTC, milliseconds) for TEXT date columns.
pub fn iso(epoch_ms: i64) -> String {
    crate::domain::events::iso_millis(epoch_ms)
}

pub fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

pub fn text(value: impl Into<String>) -> Sql {
    Sql::Text(value.into())
}

pub fn int(value: i64) -> Sql {
    Sql::Integer(value)
}

pub fn opt_text(value: Option<&str>) -> Sql {
    value.map_or(Sql::Null, |v| Sql::Text(v.into()))
}

pub fn opt_int(value: Option<i64>) -> Sql {
    value.map_or(Sql::Null, Sql::Integer)
}

pub fn flag(value: bool) -> Sql {
    Sql::Integer(i64::from(value))
}

pub fn placeholders(count: usize) -> String {
    if count == 0 {
        "NULL".into()
    } else {
        vec!["?"; count].join(",")
    }
}
